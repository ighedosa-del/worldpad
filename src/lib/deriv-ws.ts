'use client';

// ---- Deriv WebSocket Layer (v11 — ORIGINAL SIMPLE APPROACH) ----
// Direct browser → wss://ws.derivws.com/websockets/v3?app_id=1089
// Authorize with API token via ws.send({ authorize: token })
// No PAT, no OTP, no REST proxy. Simple and reliable.

let ws: WebSocket | null = null;
let wsAuthorized = false;
let authorizedLoginId = '';
let authorizedIsVirtual = false;
let authorizedScopes = '';
let authorizedBalance = 0;

// Auth state
let storedToken = '';
let storedAppId = '';

// Connection lock
let connectionPromise: Promise<void> | null = null;
let isConnecting = false;

// Promise-based request/response
let reqIdCounter = 1;
const pendingRequests = new Map<number, { resolve: (data: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();

// Tick/balance callbacks (for single-market WS — not used by GlobalAI)
let tickCallback: ((data: { tick: number; digit: number; price: string }) => void) | null = null;
let balanceCallback: ((balance: number) => void) | null = null;
let tickSubId: number | null = null;
let balanceSubId: number | null = null;
let currentSymbol: string = '';
let simulationInterval: ReturnType<typeof setInterval> | null = null;
let useSimulation = false;
let hasEverConnected = false;

// ---- Public API ----

export function getTradeWSStatus(): {
  wsReady: boolean; hasToken: boolean; authorized: boolean; loginId: string; scopes: string; isVirtual: boolean; tokenPreview: string;
} {
  return {
    wsReady: ws?.readyState === WebSocket.OPEN && wsAuthorized,
    hasToken: !!storedToken,
    authorized: wsAuthorized,
    loginId: authorizedLoginId,
    scopes: authorizedScopes,
    isVirtual: authorizedIsVirtual,
    tokenPreview: storedToken ? `${storedToken.slice(0, 8)}...` : '(none)',
  };
}

export interface AuthorizeResult {
  fullname: string;
  loginid: string;
  balance: number;
  currency: string;
  accountType: 'demo' | 'real';
}

export interface DerivAccount {
  account_id: string;
  balance: string;
  currency: string;
  account_type: 'demo' | 'real';
  status: string;
}

// Simple connect + authorize in one step
export async function authorizeViaWS(token: string, appId: string): Promise<AuthorizeResult> {
  storedToken = token;
  storedAppId = appId;

  // Close existing connection
  if (ws) { try { ws.close(); } catch {} ws = null; }
  wsAuthorized = false;
  connectionPromise = null;

  return new Promise((resolve, reject) => {
    const url = 'wss://ws.derivws.com/websockets/v3?app_id=1089';
    console.log('[DerivWS] Connecting to', url);

    try {
      ws = new WebSocket(url);
    } catch (e) {
      reject(new Error('Cannot create WebSocket'));
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error('Connection timeout (10s)'));
    }, 10000);

    ws.onopen = () => {
      console.log('[DerivWS] ✅ Connected, sending authorize...');
      // Authorize using the ORIGINAL simple method
      ws!.send(JSON.stringify({ authorize: token }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle authorize response
        if (data.msg_type === 'authorize') {
          if (data.error) {
            clearTimeout(timer);
            reject(new Error(data.error.message || 'Authorization failed'));
            return;
          }
          clearTimeout(timer);
          wsAuthorized = true;
          authorizedLoginId = data.authorize.loginid;
          authorizedIsVirtual = data.authorize.is_virtual;
          authorizedScopes = (data.authorize.scopes || []).join(',');
          authorizedBalance = parseFloat(data.authorize.balance) || 0;
          hasEverConnected = true;
          useSimulation = false;

          console.log('[DerivWS] ✅ Authorized:', authorizedLoginId, 'virtual:', authorizedIsVirtual, 'balance:', authorizedBalance);

          resolve({
            fullname: data.authorize.fullname || '',
            loginid: data.authorize.loginid,
            balance: authorizedBalance,
            currency: data.authorize.currency || 'USD',
            accountType: authorizedIsVirtual ? 'demo' : 'real',
          });
          return;
        }

        // Route pending requests (proposal/buy)
        if (data.req_id && pendingRequests.has(data.req_id)) {
          const pending = pendingRequests.get(data.req_id)!;
          clearTimeout(pending.timer);
          pendingRequests.delete(data.req_id);
          if (data.error) {
            pending.reject(new Error(data.error.message || 'API error'));
          } else {
            pending.resolve(data);
          }
          return;
        }

        // Handle tick/balance subscriptions
        if (data.subscription) {
          if (data.msg_type === 'tick' && data.subscription.id) tickSubId = data.subscription.id;
          if (data.msg_type === 'balance' && data.subscription.id) balanceSubId = data.subscription.id;
        }

        if (data.msg_type === 'tick' && data.tick) {
          const priceStr = data.tick.quote.toString();
          const lastDigit = parseInt(priceStr[priceStr.length - 1], 10);
          tickCallback?.({ tick: parseFloat(data.tick.quote), digit: lastDigit, price: data.tick.quote });
        }

        if (data.msg_type === 'balance' && data.balance) {
          balanceCallback?.(parseFloat(data.balance.balance));
          try {
            import('./store').then(({ useWorldpadStore }) => {
              useWorldpadStore.getState().setBalance(parseFloat(data.balance.balance) || 0);
            });
          } catch {}
        }

        if (data.error) {
          console.warn('[DerivWS] Error:', data.error.message);
        }
      } catch {}
    };

    ws.onclose = (e) => {
      clearTimeout(timer);
      console.warn('[DerivWS] WS closed: code=', e.code, 'reason=', e.reason || 'none');
      const wasAuthorized = wsAuthorized;
      wsAuthorized = false;
      connectionPromise = null;

      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error('WebSocket closed'));
        pendingRequests.delete(id);
      }

      // If we were authorized, this is a normal disconnect — reconnect on next trade
      // If we never authorized, reject the connection promise
      if (!wasAuthorized && isConnecting) {
        reject(new Error(`WebSocket closed (code ${e.code}) before authorization`));
      }
    };

    ws.onerror = () => {
      clearTimeout(timer);
      console.error('[DerivWS] WebSocket error');
    };
  });
}

// Store credentials AND immediately connect + authorize
export async function restoreCredentials(token: string, appId: string): Promise<AuthorizeResult | null> {
  storedToken = token;
  storedAppId = appId;
  console.log('[DerivWS] Restoring credentials — connecting NOW...');
  try {
    const result = await authorizeViaWS(token, appId);
    console.log('[DerivWS] ✅ Restored and authorized:', result.loginid, 'balance:', result.balance);
    return result;
  } catch (err) {
    console.error('[DerivWS] Restore failed:', (err as Error).message);
    return null;
  }
}

// Legacy compat — not used in v11 but kept so imports don't break
export async function getDerivAccounts(_token: string, _appId: string): Promise<DerivAccount[]> {
  // No longer needed — we authorize directly via WS
  return [];
}

// ---- TRADE ----

export interface ProposalResult {
  id: string;
  ask_price: number;
  payout: number;
}

export interface BuyResult {
  contract_id: string;
  payout: number;
  profit: number;
  buy_price: number;
}

function sendWSRequest(msg: Record<string, unknown>, timeoutMs = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket not connected'));
      return;
    }
    if (!wsAuthorized) {
      reject(new Error('WebSocket not authorized'));
      return;
    }

    const reqId = reqIdCounter++;
    const payload = { ...msg, req_id: reqId };
    console.log('[DerivWS] Send:', msg.proposal ? 'PROPOSAL' : msg.buy ? 'BUY' : msg.subscribe ? 'SUBSCRIBE' : 'OTHER', 'req_id:', reqId);

    const timer = setTimeout(() => {
      pendingRequests.delete(reqId);
      reject(new Error('Request timed out'));
    }, timeoutMs);

    pendingRequests.set(reqId, { resolve, reject, timer });
    ws.send(JSON.stringify(payload));
  });
}

async function ensureWSConnected(): Promise<void> {
  // Already connected and authorized?
  if (ws && ws.readyState === WebSocket.OPEN && wsAuthorized) {
    return;
  }

  // Connection in progress?
  if (connectionPromise) {
    return connectionPromise;
  }

  // WS exists but dead?
  if (ws && (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING)) {
    ws = null;
    wsAuthorized = false;
    connectionPromise = null;
  }

  // Need to reconnect?
  if (!storedToken) {
    throw new Error('No API token stored. Click Connect Account.');
  }

  isConnecting = true;
  connectionPromise = authorizeViaWS(storedToken, storedAppId)
    .then(() => { connectionPromise = null; })
    .catch((err) => { connectionPromise = null; throw err; })
    .finally(() => { isConnecting = false; });

  try {
    await connectionPromise;
  } catch (err) {
    connectionPromise = null;
    throw err;
  }
}

export async function getProposalWS(params: {
  contractType: string;
  symbol: string;
  stake: number;
  barrier?: number;
  duration?: number;
  durationUnit?: string;
}): Promise<ProposalResult> {
  console.log('[DerivWS] getProposalWS:', params.contractType, params.symbol, '$' + params.stake);

  await ensureWSConnected();

  const payload: Record<string, unknown> = {
    proposal: 1,
    amount: params.stake,
    basis: 'stake',
    contract_type: params.contractType,
    underlying_symbol: params.symbol,
    duration: params.duration || 1,
    duration_unit: params.durationUnit || 't',
    currency: 'USD',
  };
  if (params.barrier !== undefined) {
    payload.barrier = params.barrier.toString();
  }

  const data = await sendWSRequest(payload, 10000);

  if (!data.proposal) {
    throw new Error(data.error?.message || 'No proposal in response');
  }

  return {
    id: data.proposal.id,
    ask_price: parseFloat(data.proposal.ask_price) || 0,
    payout: parseFloat(data.proposal.payout) || 0,
  };
}

export async function buyContractWS(proposalId: string, askPrice: number): Promise<BuyResult> {
  console.log('[DerivWS] buyContractWS: proposalId=', proposalId, 'price=', askPrice);

  const data = await sendWSRequest({ buy: proposalId, price: askPrice }, 10000);

  if (!data.buy) {
    throw new Error(data.error?.message || 'Buy failed — no buy in response');
  }

  return {
    contract_id: data.buy.contract_id?.toString() || '',
    payout: parseFloat(data.buy.payout) || 0,
    profit: parseFloat(data.buy.profit) || 0,
    buy_price: parseFloat(data.buy.buy_price) || 0,
  };
}

// Public export for auth-modal
export const ensureWSConnectedDirect = ensureWSConnected;

// ---- Simulation ----

function seededRandom(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  return function() {
    h = h ^ (h << 13);
    h = h ^ (h >> 17);
    h = h ^ (h << 5);
    return ((h >>> 0) % 1000) / 1000;
  };
}

function startSimulation(symbol: string, onTick: (data: { tick: number; digit: number; price: string }) => void) {
  const rng = seededRandom(symbol + '-worldpad');
  const basePrice = symbol.includes('100') ? 1000 : symbol.includes('75') ? 750 : symbol.includes('50') ? 500 : symbol.includes('25') ? 250 : 100;
  let price = basePrice + rng() * 100;
  useSimulation = true;
  simulationInterval = setInterval(() => {
    const change = (rng() - 0.5) * basePrice * 0.002;
    price = Math.max(price * 0.5, price + change);
    const priceStr = price.toFixed(2);
    const lastDigit = parseInt(priceStr[priceStr.length - 1], 10);
    onTick({ tick: price, digit: lastDigit, price: priceStr });
  }, 1000);
}

function stopSimulation() {
  if (simulationInterval) { clearInterval(simulationInterval); simulationInterval = null; }
  useSimulation = false;
}

export function isSimulating() { return useSimulation; }

// ---- Tick streaming (single-market, for manual trading tab) ----

export function connectDerivWS(
  symbol: string,
  onTick: (data: { tick: number; digit: number; price: string }) => void,
  onBalance?: (balance: number) => void,
  onConnect?: () => void,
  onDisconnect?: () => void
) {
  tickCallback = onTick;
  if (onBalance) balanceCallback = onBalance;
  currentSymbol = symbol;
  stopSimulation();

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    subscribeToTicks(symbol);
    onConnect?.();
    return;
  }

  if (storedToken) {
    if (isConnecting) return;
    isConnecting = true;
    ensureWSConnected()
      .then(() => {
        isConnecting = false;
        onConnect?.();
        subscribeToTicks(symbol);
        if (balanceCallback) ws?.send(JSON.stringify({ balance: 1, subscribe: 1 }));
      })
      .catch(() => {
        isConnecting = false;
        console.log('[DerivWS] Connect failed, switching to simulation');
        startSimulation(symbol, onTick);
        onConnect?.();
      });
    return;
  }

  startSimulation(symbol, onTick);
  onConnect?.();
}

function subscribeToTicks(symbol: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (tickSubId !== null) { ws.send(JSON.stringify({ forget: tickSubId })); tickSubId = null; }
  ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
  currentSymbol = symbol;
}

export function switchSymbol(symbol: string) {
  if (useSimulation) { stopSimulation(); if (tickCallback) startSimulation(symbol, tickCallback); return; }
  subscribeToTicks(symbol);
}

export function disconnectDerivWS() {
  stopSimulation();
  hasEverConnected = false;
  wsAuthorized = false;
  storedToken = '';
  storedAppId = '';
  connectionPromise = null;
  isConnecting = false;
  if (ws) { ws.close(); ws = null; }
  tickCallback = null;
  balanceCallback = null;
  tickSubId = null;
  balanceSubId = null;
}

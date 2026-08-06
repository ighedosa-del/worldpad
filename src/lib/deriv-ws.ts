'use client';

// ---- New Deriv API (OTP-based auth) ----

let ws: WebSocket | null = null;
let tickCallback: ((data: { tick: number; digit: number; price: string }) => void) | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let balanceCallback: ((balance: number) => void) | null = null;
let tickSubId: number | null = null;
let balanceSubId: number | null = null;
let currentSymbol: string = '';
let simulationInterval: ReturnType<typeof setInterval> | null = null;
let useSimulation = false;
let hasEverConnected = false;

// Auth state for OTP reconnection
let storedPatToken: string = '';
let storedAppId: string = '';
let storedAccountId: string = '';

// Promise-based request/response over WebSocket
let reqIdCounter = 1;
const pendingRequests = new Map<number, { resolve: (data: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function sendWSRequest(msg: Record<string, unknown>, timeoutMs = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket not connected'));
      return;
    }

    const reqId = reqIdCounter++;
    const payload = { ...msg, req_id: reqId };

    const timer = setTimeout(() => {
      pendingRequests.delete(reqId);
      reject(new Error('Request timed out'));
    }, timeoutMs);

    pendingRequests.set(reqId, { resolve, reject, timer });
    ws.send(JSON.stringify(payload));
  });
}

// Match incoming WS messages to pending requests
function handleIncomingMessage(data: any) {
  if (data.req_id && pendingRequests.has(data.req_id)) {
    const pending = pendingRequests.get(data.req_id)!;
    clearTimeout(pending.timer);
    pendingRequests.delete(data.req_id);

    if (data.error) {
      pending.reject(new Error(data.error.message || 'API error'));
    } else {
      pending.resolve(data);
    }
    return true;
  }
  return false;
}

// ---- Types ----

export interface DerivAccount {
  account_id: string;
  balance: string;
  currency: string;
  account_type: 'demo' | 'real';
  status: string;
}

export interface AuthorizeResult {
  fullname: string;
  loginid: string;
  balance: number;
  currency: string;
  accountType: 'demo' | 'real';
}

// ---- NEW AUTH FLOW: REST OTP ----

export async function getDerivAccounts(patToken: string, appId: string): Promise<DerivAccount[]> {
  const res = await fetch('/api/deriv-auth?action=accounts', {
    headers: {
      'authorization': `Bearer ${patToken}`,
      'x-deriv-app-id': appId,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch accounts (HTTP ${res.status})`);
  }
  const data = await res.json();
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error('Invalid response from Deriv');
  }
  return data.data.map((a: any) => ({
    account_id: a.account_id,
    balance: a.balance,
    currency: a.currency,
    account_type: a.account_type,
    status: a.status,
  }));
}

async function requestOtpWsUrl(patToken: string, appId: string, accountId: string): Promise<string> {
  const res = await fetch('/api/deriv-auth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'authorization': `Bearer ${patToken}`,
      'x-deriv-app-id': appId,
    },
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to get OTP (HTTP ${res.status})`);
  }
  const data = await res.json();
  if (!data.data?.url) {
    throw new Error(data.errors?.[0]?.message || 'No WebSocket URL returned');
  }
  return data.data.url;
}

export async function authorizeViaWS(patToken: string, appId: string, accountId: string): Promise<AuthorizeResult> {
  // Store for reconnection
  storedPatToken = patToken;
  storedAppId = appId;
  storedAccountId = accountId;

  // Get OTP WebSocket URL via server proxy
  const wsUrl = await requestOtpWsUrl(patToken, appId, accountId);
  console.log('[DerivWS] Got OTP WebSocket URL');

  // Get account info from the accounts list to return balance etc.
  const accounts = await getDerivAccounts(patToken, appId);
  const account = accounts.find(a => a.account_id === accountId);
  if (!account) {
    throw new Error('Account not found');
  }

  return {
    fullname: '',
    loginid: account.account_id,
    balance: parseFloat(account.balance) || 0,
    currency: account.currency || 'USD',
    accountType: account.account_type,
  };
}

// ---- TRADE via WebSocket (uses underlying_symbol) ----

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

export async function getProposalWS(params: {
  contractType: string;
  symbol: string;
  stake: number;
  barrier?: number;
  duration?: number;
  durationUnit?: string;
}): Promise<ProposalResult> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    await ensureWSConnected();
  }

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
    throw new Error(data.error?.message || 'No proposal received');
  }

  return {
    id: data.proposal.id,
    ask_price: parseFloat(data.proposal.ask_price) || 0,
    payout: parseFloat(data.proposal.payout) || 0,
  };
}

export async function buyContractWS(proposalId: string, askPrice: number): Promise<BuyResult> {
  const data = await sendWSRequest({ buy: proposalId, price: askPrice }, 10000);

  if (!data.buy) {
    throw new Error(data.error?.message || 'Buy failed');
  }

  return {
    contract_id: data.buy.contract_id?.toString() || '',
    payout: parseFloat(data.buy.payout) || 0,
    profit: parseFloat(data.buy.profit) || 0,
    buy_price: parseFloat(data.buy.buy_price) || 0,
  };
}

// ---- Ensure WS is connected (via OTP) ----

async function ensureWSConnected(): Promise<void> {
 return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }

    if (ws && ws.readyState === WebSocket.CONNECTING) {
      const check = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) { clearInterval(check); resolve(); }
        else if (!ws || ws.readyState === WebSocket.CLOSED) { clearInterval(check); reject(new Error('Connection failed')); }
      }, 200);
      setTimeout(() => { clearInterval(check); reject(new Error('Connection timeout')); }, 15000);
      return;
    }

    // If we have auth credentials, get OTP and connect
    if (storedPatToken && storedAppId && storedAccountId) {
      requestOtpWsUrl(storedPatToken, storedAppId, storedAccountId)
        .then(wsUrl => {
          connectToWsUrl(wsUrl, resolve, reject);
        })
        .catch(err => {
          reject(new Error('Failed to get OTP: ' + err.message));
        });
      return;
    }

    reject(new Error('Not authenticated. Please connect your Deriv account.'));
  });
}

function connectToWsUrl(wsUrl: string, resolve: () => void, reject: (err: Error) => void) {
  try {
    ws = new WebSocket(wsUrl);
  } catch {
    reject(new Error('Cannot create WebSocket'));
    return;
  }

  const timer = setTimeout(() => {
    reject(new Error('WebSocket connection timeout'));
  }, 10000);

  ws.onopen = () => {
    clearTimeout(timer);
    hasEverConnected = true;
    useSimulation = false;
    console.log('[DerivWS] Connected via OTP');
    resolve();
  };

  ws.onerror = () => {
    clearTimeout(timer);
    reject(new Error('WebSocket connection error'));
  };

  ws.onclose = () => {
    clearTimeout(timer);
    // Don't reject here - onclose is handled by the reconnect logic
  };
}

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
  console.log('[DerivWS] Using simulation mode for', symbol);

  simulationInterval = setInterval(() => {
    const change = (rng() - 0.5) * basePrice * 0.002;
    price = Math.max(price * 0.5, price + change);
    const priceStr = price.toFixed(2);
    const lastDigit = parseInt(priceStr[priceStr.length - 1], 10);
    onTick({ tick: price, digit: lastDigit, price: priceStr });
  }, 1000);
}

function stopSimulation() {
  if (simulationInterval) {
    clearInterval(simulationInterval);
    simulationInterval = null;
  }
  useSimulation = false;
}

export function isSimulating() {
  return useSimulation;
}

// ---- Tick streaming ----

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
    return;
  }

  // If we have OTP credentials, connect via OTP
  if (storedPatToken && storedAppId && storedAccountId) {
    requestOtpWsUrl(storedPatToken, storedAppId, storedAccountId)
      .then(wsUrl => {
        setupWsConnection(wsUrl, symbol, onTick, onBalance, onConnect, onDisconnect);
      })
      .catch(() => {
        console.log('[DerivWS] OTP failed, switching to simulation');
        startSimulation(symbol, onTick);
        onConnect?.();
      });
    return;
  }

  // No auth — simulation mode
  startSimulation(symbol, onTick);
  onConnect?.();
}

function setupWsConnection(
  wsUrl: string,
  symbol: string,
  onTick: (data: { tick: number; digit: number; price: string }) => void,
  onBalance?: ((balance: number) => void) | null,
  onConnect?: (() => void) | null,
  onDisconnect?: (() => void) | null
) {
  try {
    ws = new WebSocket(wsUrl);
  } catch {
    startSimulation(symbol, onTick);
    onConnect?.();
    return;
  }

  const connectTimeout = setTimeout(() => {
    if (ws && ws.readyState !== WebSocket.OPEN) {
      console.log('[DerivWS] Connection timeout, switching to simulation');
      ws.close();
      ws = null;
      startSimulation(symbol, onTick);
      onConnect?.();
    }
  }, 10000);

  ws.onopen = () => {
    clearTimeout(connectTimeout);
    hasEverConnected = true;
    useSimulation = false;
    console.log('[DerivWS] Connected to Deriv via OTP (live)');
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    onConnect?.();
    subscribeToTicks(symbol);
    if (balanceCallback) {
      ws?.send(JSON.stringify({ balance: 1, subscribe: 1 }));
    }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (handleIncomingMessage(data)) return;

      if (data.subscription) {
        if (data.msg_type === 'tick' && data.subscription.id) {
          tickSubId = data.subscription.id;
        }
        if (data.msg_type === 'balance' && data.subscription.id) {
          balanceSubId = data.subscription.id;
        }
      }

      if (data.msg_type === 'tick' && data.tick) {
        const priceStr = data.tick.quote.toString();
        const lastDigit = parseInt(priceStr[priceStr.length - 1], 10);
        const tickPrice = parseFloat(data.tick.quote);
        tickCallback?.({ tick: tickPrice, digit: lastDigit, price: data.tick.quote });
      }

      if (data.msg_type === 'balance' && data.balance) {
        balanceCallback?.(parseFloat(data.balance.balance));
      }

      if (data.error) {
        console.warn('[DerivWS] API error:', data.error.message);
      }
    } catch {
      // ignore
    }
  };

  ws.onclose = () => {
    clearTimeout(connectTimeout);
    tickSubId = null;
    balanceSubId = null;
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('WebSocket closed'));
      pendingRequests.delete(id);
    }
    if (!hasEverConnected) {
      console.log('[DerivWS] Never connected live, switching to simulation');
      ws = null;
      startSimulation(currentSymbol, onTick);
      onConnect?.();
      return;
    }
    console.log('[DerivWS] Disconnected, reconnecting with new OTP...');
    onDisconnect?.();
    reconnectTimer = setTimeout(() => {
      console.log('[DerivWS] Reconnecting...');
      if (storedPatToken && storedAppId && storedAccountId) {
        requestOtpWsUrl(storedPatToken, storedAppId, storedAccountId)
          .then(wsUrl => {
            setupWsConnection(wsUrl, currentSymbol, onTick, onBalance, onConnect, onDisconnect);
          })
          .catch(() => {
            // If OTP fails, try again in 5s
            reconnectTimer = setTimeout(() => {
              connectDerivWS(currentSymbol, onTick, onBalance ?? undefined, onConnect ?? undefined, onDisconnect ?? undefined);
            }, 5000);
          });
      }
    }, 3000);
  };

  ws.onerror = () => {
    console.warn('[DerivWS] WebSocket error');
  };
}

function subscribeToTicks(symbol: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  if (tickSubId !== null) {
    ws.send(JSON.stringify({ forget: tickSubId }));
    tickSubId = null;
  }

  ws.send(JSON.stringify({
    ticks: symbol,
    subscribe: 1,
  }));
  currentSymbol = symbol;
}

export function switchSymbol(symbol: string) {
  if (useSimulation) {
    stopSimulation();
    if (tickCallback) {
      startSimulation(symbol, tickCallback);
    }
    return;
  }
  subscribeToTicks(symbol);
}

export function disconnectDerivWS() {
  stopSimulation();
  hasEverConnected = false;
  storedPatToken = '';
  storedAppId = '';
  storedAccountId = '';
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Disconnected'));
    pendingRequests.delete(id);
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  tickCallback = null;
  balanceCallback = null;
  tickSubId = null;
  balanceSubId = null;
}

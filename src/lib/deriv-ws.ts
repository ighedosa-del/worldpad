'use client';

const DERIV_APP_ID = '1089';
const DERIV_WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

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

// Promise-based request/response over WebSocket
const pendingRequests = new Map<string, { resolve: (data: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function sendWSRequest(msg: Record<string, unknown>, timeoutMs = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    // If we don't have a live WS, fail immediately
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket not connected'));
      return;
    }

    const reqId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
  // Check if this is a response to a pending request
  if (data.req_id && pendingRequests.has(data.req_id)) {
    const pending = pendingRequests.get(data.req_id)!;
    clearTimeout(pending.timer);
    pendingRequests.delete(data.req_id);

    if (data.error) {
      pending.reject(new Error(data.error.message || 'API error'));
    } else {
      pending.resolve(data);
    }
    return true; // consumed
  }
  return false; // not consumed, let tick/balance handlers process it
}

// ---- AUTH via WebSocket ----

export interface AuthorizeResult {
  fullname: string;
  loginid: string;
  balance: number;
  currency: string;
}

export async function authorizeViaWS(token: string): Promise<AuthorizeResult> {
  // Ensure we have a live WebSocket connection
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    await ensureWSConnected();
  }

  const data = await sendWSRequest({ authorize: token }, 10000);

  if (!data.authorize) {
    throw new Error(data.error?.message || 'Authorization failed');
  }

  return {
    fullname: data.authorize.fullname || '',
    loginid: data.authorize.loginid || '',
    balance: parseFloat(data.authorize.balance) || 0,
    currency: data.authorize.currency || 'USD',
  };
}

// ---- TRADE via WebSocket ----

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
    symbol: params.symbol,
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
    contract_id: data.buy.contract_id.toString(),
    payout: parseFloat(data.buy.payout) || 0,
    profit: parseFloat(data.buy.profit) || 0,
    buy_price: parseFloat(data.buy.buy_price) || 0,
  };
}

// ---- Ensure WS is connected ----

function ensureWSConnected(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }

    if (ws && ws.readyState === WebSocket.CONNECTING) {
      // Wait for existing connection
      const check = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          clearInterval(check);
          resolve();
        } else if (!ws || ws.readyState === WebSocket.CLOSED) {
          clearInterval(check);
          reject(new Error('Connection failed'));
        }
      }, 200);
      setTimeout(() => { clearInterval(check); reject(new Error('Connection timeout')); }, 10000);
      return;
    }

    // Fresh connection
    try {
      ws = new WebSocket(DERIV_WS_URL);
    } catch {
      reject(new Error('Cannot create WebSocket'));
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error('WebSocket connection timeout'));
    }, 8000);

    ws.onopen = () => {
      clearTimeout(timer);
      hasEverConnected = true;
      useSimulation = false;
      resolve();
    };

    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('WebSocket connection error'));
    };

    ws.onclose = () => {
      clearTimeout(timer);
      reject(new Error('WebSocket closed'));
    };
  });
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

  try {
    ws = new WebSocket(DERIV_WS_URL);
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
  }, 5000);

  ws.onopen = () => {
    clearTimeout(connectTimeout);
    hasEverConnected = true;
    useSimulation = false;
    console.log('[DerivWS] Connected to Deriv (live)');
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

      // Let request/response handler try to consume this first
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
    // Reject all pending requests
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('WebSocket closed'));
      pendingRequests.delete(id);
    }
    if (!hasEverConnected) {
      console.log('[DerivWS] Never connected live, switching to simulation');
      ws = null;
      startSimulation(currentSymbol, onTick!);
      onConnect?.();
      return;
    }
    console.log('[DerivWS] Disconnected (was live before, reconnecting)');
    onDisconnect?.();
    reconnectTimer = setTimeout(() => {
      console.log('[DerivWS] Reconnecting...');
      connectDerivWS(currentSymbol, onTick!, onBalance, onConnect, onDisconnect);
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
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // Reject all pending requests
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

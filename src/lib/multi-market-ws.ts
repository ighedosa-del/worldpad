'use client';

// === Multi-Market Scanner ===
// Uses ticks_history polling because Deriv public WS rejects tick subscriptions.
// RATE LIMIT SAFE: Round-robin polling — 1 request per 800ms cycling through 10 markets.
// This gives ~1.25 req/s, well within Deriv's public API limits.
// Uses count=5 to extract multiple new ticks per request.

export const SCANNED_MARKETS = [
  { symbol: 'R_100', name: 'Volatility 100',   type: 'standard' as const },
  { symbol: 'R_10',  name: 'Volatility 10',    type: 'standard' as const },
  { symbol: 'R_25',  name: 'Volatility 25',    type: 'standard' as const },
  { symbol: 'R_50',  name: 'Volatility 50',    type: 'standard' as const },
  { symbol: 'R_75',  name: 'Volatility 75',    type: 'standard' as const },
  { symbol: '1HZ100V', name: 'Volatility 100 (1s)', type: 'fast' as const },
  { symbol: '1HZ10V',  name: 'Volatility 10 (1s)',  type: 'fast' as const },
  { symbol: '1HZ25V',  name: 'Volatility 25 (1s)',  type: 'fast' as const },
  { symbol: '1HZ50V',  name: 'Volatility 50 (1s)',  type: 'fast' as const },
  { symbol: '1HZ75V',  name: 'Volatility 75 (1s)',  type: 'fast' as const },
] as const;

export type MarketSymbol = (typeof SCANNED_MARKETS)[number]['symbol'];

export interface MarketTickData {
  digit: number;
  price: string;
  timestamp: number;
}

export interface MarketData {
  symbol: MarketSymbol;
  name: string;
  type: 'standard' | 'fast';
  digits: number[];
  distribution: number[];
  distributionPct: number[];
  lastTick: MarketTickData | null;
  tickCount: number;
  connected: boolean;
}

export type MarketDataMap = Record<MarketSymbol, MarketData>;
export type OnMarketTickCallback = (symbol: MarketSymbol, data: MarketData) => void;

const MAX_DIGITS = 500;
const DERIV_WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';

// === State ===
let ws: WebSocket | null = null;
let marketData: MarketDataMap;
let tickCallbacks: Set<OnMarketTickCallback> = new Set();
let isConnected = false;
let totalTicksReceived = 0;
let lastTickTime = 0;
let connectTime = 0;
let wsError: string | null = null;
let scanningActive = false;
let reqIdCounter = 1;
let pendingRequests = new Map<number, {
  symbol: MarketSymbol;
  resolve: (data: any) => void;
}>();

// Round-robin state
let pollTimer: ReturnType<typeof setInterval> | null = null;
let roundRobinIndex = 0;
let isRequestInFlight = false;

function initMarketData(): MarketDataMap {
  const data = {} as MarketDataMap;
  for (const m of SCANNED_MARKETS) {
    data[m.symbol] = {
      symbol: m.symbol,
      name: m.name,
      type: m.type,
      digits: [],
      distribution: new Array(10).fill(0),
      distributionPct: new Array(10).fill(0),
      lastTick: null,
      tickCount: 0,
      connected: false,
    };
  }
  return data;
}

marketData = initMarketData();

function updateDistribution(md: MarketData) {
  const dist = new Array(10).fill(0);
  for (let i = 0; i < md.digits.length; i++) {
    dist[md.digits[i]]++;
  }
  md.distribution = dist;
  const total = md.digits.length || 1;
  for (let i = 0; i < 10; i++) {
    md.distributionPct[i] = (dist[i] / total) * 100;
  }
}

function requestTicksHistory(symbol: string, count: number): Promise<{ prices: number[]; times: number[] } | null> {
  return new Promise((resolve) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      resolve(null);
      return;
    }
    const reqId = reqIdCounter++;
    const timer = setTimeout(() => {
      pendingRequests.delete(reqId);
      isRequestInFlight = false;
      resolve(null);
    }, 5000);
    pendingRequests.set(reqId, {
      symbol: symbol as MarketSymbol,
      resolve: (data) => { clearTimeout(timer); resolve(data); },
    });
    ws.send(JSON.stringify({
      ticks_history: symbol,
      count: count,
      end: 'latest',
      style: 'ticks',
      req_id: reqId,
    }));
  });
}

function processNewTicks(symbol: MarketSymbol, prices: number[], times: number[]) {
  const md = marketData[symbol];
  if (!md || prices.length === 0) return;

  let anyNew = false;
  // Process from oldest to newest, skip duplicates
  for (let i = 0; i < prices.length; i++) {
    const price = prices[i];
    const priceStr = price.toFixed(3);
    const lastDigit = parseInt(priceStr[priceStr.length - 1], 10);

    // Deduplicate: skip if same as last tick
    if (md.lastTick && md.lastTick.price === priceStr) continue;

    md.digits.push(lastDigit);
    if (md.digits.length > MAX_DIGITS) md.digits.shift();
    md.lastTick = { digit: lastDigit, price: priceStr, timestamp: times[i] || Date.now() };
    md.tickCount++;
    totalTicksReceived++;
    lastTickTime = Date.now();
    md.connected = true;
    anyNew = true;
  }

  if (anyNew) {
    updateDistribution(md);
    // Notify callbacks
    const snapshot = { ...md };
    for (const cb of tickCallbacks) {
      try { cb(symbol, snapshot); } catch (_) { /* skip */ }
    }
  }
}

function handleMessage(event: MessageEvent) {
  try {
    const msg = JSON.parse(event.data);

    // Handle ticks_history response
    if (msg.msg_type === 'history' && msg.history && msg.history.prices) {
      const reqId = msg.req_id;
      if (reqId !== undefined && pendingRequests.has(reqId)) {
        const pending = pendingRequests.get(reqId)!;
        pendingRequests.delete(reqId);
        isRequestInFlight = false;

        // Clear rate limit error on successful response
        if (wsError && wsError.includes('rate limit')) {
          wsError = null;
        }

        const { prices, times } = msg.history;
        if (prices.length > 0) {
          processNewTicks(pending.symbol, prices, times);
        }
        pending.resolve(msg.history);
      }
      return;
    }

    // Handle errors
    if (msg.error) {
      const reqId = msg.req_id;
      if (reqId !== undefined && pendingRequests.has(reqId)) {
        const pending = pendingRequests.get(reqId)!;
        pendingRequests.delete(reqId);
        isRequestInFlight = false;
        const errMsg = msg.error.message || 'Unknown error';
        console.warn('[MultiMarketWS] Error for', pending.symbol, ':', errMsg);
        wsError = errMsg;
        pending.resolve(null);
      }
    }
  } catch {
    // ignore parse errors
  }
}

// === Round-Robin Polling ===
// One request every 800ms, cycling through all 10 markets.
// ~1.25 req/s total — safe for Deriv public API.
// Fast markets get polled 2x per full cycle (they appear twice in the rotation).

function buildPollOrder(): MarketSymbol[] {
  // Interleave: fast markets appear twice as often as standard
  const fast: MarketSymbol[] = SCANNED_MARKETS.filter(m => m.type === 'fast').map(m => m.symbol);
  const standard: MarketSymbol[] = SCANNED_MARKETS.filter(m => m.type === 'standard').map(m => m.symbol);
  const order: MarketSymbol[] = [];
  const maxLen = Math.max(fast.length, standard.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < fast.length) order.push(fast[i]);
    if (i < standard.length) order.push(standard[i]);
  }
  return order;
}

const POLL_ORDER = buildPollOrder();
// Result: [1HZ100V, R_100, 1HZ10V, R_10, 1HZ25V, R_25, 1HZ50V, R_50, 1HZ75V, R_75]
// 10 items, each polled once per cycle = 10 * 800ms = 8s per full cycle
// Fast markets: ~4s between polls, Standard: ~8s between polls

const ROUND_ROBIN_INTERVAL = 800; // ms between requests

function pollNextMarket() {
  if (isRequestInFlight) return; // skip if previous request still pending
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const symbol = POLL_ORDER[roundRobinIndex % POLL_ORDER.length];
  roundRobinIndex++;

  isRequestInFlight = true;
  requestTicksHistory(symbol, 5)
    .catch(() => { isRequestInFlight = false; });
}

function startPolling() {
  stopPolling();
  roundRobinIndex = 0;
  isRequestInFlight = false;
  // Fire first 3 requests immediately (staggered by 200ms) to seed data faster
  for (let i = 0; i < 3; i++) {
    setTimeout(() => pollNextMarket(), i * 200);
  }
  // Then continue round-robin
  pollTimer = setInterval(pollNextMarket, ROUND_ROBIN_INTERVAL);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  isRequestInFlight = false;
}

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectInternal();
  }, 5000);
}

function connectInternal() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  wsError = null;
  connectTime = Date.now();

  try {
    ws = new WebSocket(DERIV_WS_URL);
  } catch (e) {
    wsError = 'WS create failed: ' + (e as Error).message;
    console.error('[MultiMarketWS]', wsError);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    isConnected = true;
    console.log('[MultiMarketWS] Connected - round-robin polling', SCANNED_MARKETS.length, 'markets @', ROUND_ROBIN_INTERVAL, 'ms interval');
    startPolling();
  };

  ws.onmessage = handleMessage;

  ws.onclose = () => {
    console.log('[MultiMarketWS] Closed');
    isConnected = false;
    stopPolling();
    for (const m of SCANNED_MARKETS) marketData[m.symbol].connected = false;
    if (scanningActive) scheduleReconnect();
  };

  ws.onerror = () => {
    wsError = 'WS error';
    console.warn('[MultiMarketWS] Connection error');
  };
}

// === PUBLIC API ===

export function startMultiMarketScan(onTick?: OnMarketTickCallback): void {
  if (onTick) tickCallbacks.add(onTick);
  scanningActive = true;
  connectInternal();
}

export function stopMultiMarketScan(): void {
  scanningActive = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  stopPolling();
  for (const [, p] of pendingRequests) p.resolve(null);
  pendingRequests.clear();
  if (ws) { ws.close(); ws = null; }
  isConnected = false;
  for (const m of SCANNED_MARKETS) marketData[m.symbol].connected = false;
}

export function getMarketData(symbol: MarketSymbol): MarketData {
  return marketData[symbol];
}

export function getAllMarketData(): MarketDataMap {
  return marketData;
}

export function isScannerConnected(): boolean {
  return isConnected;
}

export function getScannerHealth() {
  const ticksPerMarket: Record<string, number> = {};
  for (const m of SCANNED_MARKETS) {
    ticksPerMarket[m.symbol] = marketData[m.symbol].tickCount;
  }
  return {
    isConnected,
    totalTicksReceived,
    lastTickTime,
    connectTime,
    ticksPerMarket,
    wsError,
    callbackCount: tickCallbacks.size,
  };
}

export function addTickCallback(cb: OnMarketTickCallback): () => void {
  tickCallbacks.add(cb);
  return () => { tickCallbacks.delete(cb); };
}

export function resetMarketData(): void {
  marketData = initMarketData();
  totalTicksReceived = 0;
  lastTickTime = 0;
}

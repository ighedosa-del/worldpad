'use client';

// === Multi-Market WebSocket Scanner ===
// Connects to all 10 Volatility indices simultaneously via public Deriv WS.
// No auth needed for tick streaming — only for trading.

export const SCANNED_MARKETS = [
  { symbol: 'R_100', name: 'Volatility 100',   type: 'standard' },
  { symbol: 'R_10',  name: 'Volatility 10',    type: 'standard' },
  { symbol: 'R_25',  name: 'Volatility 25',    type: 'standard' },
  { symbol: 'R_50',  name: 'Volatility 50',    type: 'standard' },
  { symbol: 'R_75',  name: 'Volatility 75',    type: 'standard' },
  { symbol: '1HZ100V', name: 'Volatility 100 (1s)', type: 'fast' },
  { symbol: '1HZ10V',  name: 'Volatility 10 (1s)',  type: 'fast' },
  { symbol: '1HZ25V',  name: 'Volatility 25 (1s)',  type: 'fast' },
  { symbol: '1HZ50V',  name: 'Volatility 50 (1s)',  type: 'fast' },
  { symbol: '1HZ75V',  name: 'Volatility 75 (1s)',  type: 'fast' },
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
  digits: number[];          // last 500 digits
  distribution: number[];    // count per digit 0-9 (from digits array)
  distributionPct: number[]; // percentage per digit 0-9
  lastTick: MarketTickData | null;
  tickCount: number;
  connected: boolean;
}

export type MarketDataMap = Record<MarketSymbol, MarketData>;
export type OnMarketTickCallback = (symbol: MarketSymbol, data: MarketData) => void;

const MAX_DIGITS = 500;
const DERIV_PUBLIC_WS = 'wss://ws.derivws.com/websockets/v3?app_id=1089';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let marketData: MarketDataMap;
let tickCallbacks: Set<OnMarketTickCallback> = new Set();
let subscriptionIds: Map<string, number> = new Map();
let isConnected = false;
let intentionalClose = false;

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

function recalcDistribution(data: MarketData) {
  const dist = new Array(10).fill(0) as number[];
  for (const d of data.digits) {
    dist[d]++;
  }
  data.distribution = dist;
  const total = data.digits.length || 1;
  data.distributionPct = dist.map(c => (c / total) * 100);
}

function handleMessage(event: MessageEvent) {
  try {
    const msg = JSON.parse(event.data);

    if (msg.msg_type === 'tick' && msg.tick) {
      const symbol = msg.tick.symbol as MarketSymbol;
      const md = marketData[symbol];
      if (!md) return;

      const priceStr = msg.tick.quote.toString();
      const lastDigit = parseInt(priceStr[priceStr.length - 1], 10);

      md.digits.push(lastDigit);
      if (md.digits.length > MAX_DIGITS) md.digits.shift();
      md.lastTick = { digit: lastDigit, price: msg.tick.quote, timestamp: Date.now() };
      md.tickCount++;
      recalcDistribution(md);

      // Notify all listeners
      for (const cb of tickCallbacks) {
        cb(symbol, { ...md }); // shallow copy to avoid mutation issues
      }
    }

    // Track subscription IDs
    if (msg.subscription && msg.msg_type === 'tick') {
      subscriptionIds.set(msg.tick.symbol, msg.subscription.id);
    }
  } catch {
    // ignore parse errors
  }
}

function connectInternal() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  try {
    ws = new WebSocket(DERIV_PUBLIC_WS);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    isConnected = true;
    console.log('[MultiMarketWS] Connected — subscribing to', SCANNED_MARKETS.length, 'markets');

    // Subscribe to all markets
    for (const m of SCANNED_MARKETS) {
      ws?.send(JSON.stringify({ ticks: m.symbol, subscribe: 1 }));
      marketData[m.symbol].connected = true;
    }
  };

  ws.onmessage = handleMessage;

  ws.onclose = () => {
    isConnected = false;
    for (const m of SCANNED_MARKETS) {
      marketData[m.symbol].connected = false;
    }
    subscriptionIds.clear();
    if (!intentionalClose) scheduleReconnect();
  };

  ws.onerror = () => {
    console.warn('[MultiMarketWS] Connection error');
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    console.log('[MultiMarketWS] Reconnecting...');
    connectInternal();
  }, 3000);
}

// === PUBLIC API ===

export function startMultiMarketScan(onTick?: OnMarketTickCallback): void {
  if (onTick) tickCallbacks.add(onTick);
  intentionalClose = false;
  connectInternal();
}

export function stopMultiMarketScan(): void {
  intentionalClose = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { ws.close(); ws = null; }
  isConnected = false;
  subscriptionIds.clear();
  for (const m of SCANNED_MARKETS) {
    marketData[m.symbol].connected = false;
  }
  tickCallbacks.clear();
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

export function addTickCallback(cb: OnMarketTickCallback): () => void {
  tickCallbacks.add(cb);
  return () => tickCallbacks.delete(cb);
}

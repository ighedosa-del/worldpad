'use client';

// === LUCAS Strategies v2 — Multi-Strategy Registry ===
// All strategies run on 1HZ100V (Volatility 100 1s Index)
// D'Alembert progression: $0.40 base, +$0.40 on loss, -$0.40 on win (min $0.40)

import type { TickData } from './types';

// === Markets ===

export const TRADE_MARKETS = [
  { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index', type: 'fast' as const, tradable: true },
] as const;

export const DISPLAY_MARKETS = [
  { symbol: '1HZ10V', name: 'Volatility 10 (1s) Index', type: 'fast' as const, tradable: false },
  { symbol: '1HZ25V', name: 'Volatility 25 (1s) Index', type: 'fast' as const, tradable: false },
  { symbol: '1HZ50V', name: 'Volatility 50 (1s) Index', type: 'fast' as const, tradable: false },
  { symbol: '1HZ75V', name: 'Volatility 75 (1s) Index', type: 'fast' as const, tradable: false },
] as const;

export const ALL_MARKETS = [...TRADE_MARKETS, ...DISPLAY_MARKETS];
export const SCANNED_MARKETS = ALL_MARKETS;
export type MarketSymbol = (typeof ALL_MARKETS)[number]['symbol'];

// === Strategy Types ===

export interface TradeSignal {
  contractType: string;  // 'DIGITUNDER', 'DIGITOVER', 'DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF'
  barrier: number | undefined;  // For DIGITUNDER/OVER: 0-9, for MATCH/DIFF: 0-9, for EVEN/ODD: undefined
  prediction: string;   // Human-readable prediction
  confidence: number;
  reason: string;
  expectedWinRate: number;
  rsiValue: number;
}

export interface StrategyDef {
  id: string;
  name: string;
  description: string;
  contractType: string;
  barrierCount: number;  // Number of barrier variants (0 = no barrier like EVEN/ODD)
  barriers: number[];    // Barriers to cycle through (empty for EVEN/ODD)
  expectedWinRate: number;
  duration: number;
  durationUnit: string;
}

export interface MarketState {
  symbol: string;
  name: string;
  type: 'fast' | 'standard';
  tradable: boolean;
  digitHistory: number[];
  priceHistory: number[];
  distribution: number[];
  totalTicks: number;
  lastTick: TickData | null;
  lastTickTime: number;
  tradeResults: boolean[];
  lastTradeTime: number;
}

export interface ScoredMarket extends MarketState {
  score: number;
  signal: TradeSignal | null;
  rank: number;
}

// === Compatibility exports for engine ===
export const RSI_PERIOD = 5;
export const RSI_OVERSOLD = 40;
export const RSI_OVERBOUGHT = 60;
export const CALL_PUT_DURATION = 1;
export const CALL_PUT_DURATION_UNIT = 't';
export const DALEMBERT_BASE_PCT = 0.01;
export const DAILY_TAKE_PROFIT_PCT = 0.05;
export const DAILY_STOP_LOSS_PCT = 0.15;
export const MIN_PAYOUT_RATIO = 1.10;

// ============================================================
// STRATEGY REGISTRY — All 6 strategies
// ============================================================

export const STRATEGIES: StrategyDef[] = [
  {
    id: 'under-7-8-9',
    name: 'Under 7/8/9 Switcher',
    description: 'DIGITUNDER cycling barriers 7 -> 8 -> 9. Win if last digit < barrier. 70-90% win rate.',
    contractType: 'DIGITUNDER',
    barrierCount: 3,
    barriers: [7, 8, 9],
    expectedWinRate: 0.80, // average of 70% + 80% + 90% / 3
    duration: 1,
    durationUnit: 't',
  },
  {
    id: 'over-0-1-2',
    name: 'Over 0/1/2 Switcher',
    description: 'DIGITOVER cycling barriers 0 -> 1 -> 2. Win if last digit > barrier. 90-100% win rate.',
    contractType: 'DIGITOVER',
    barrierCount: 3,
    barriers: [0, 1, 2],
    expectedWinRate: 0.90,
    duration: 1,
    durationUnit: 't',
  },
  {
    id: 'even',
    name: 'Even Digit',
    description: 'DIGITEVEN — win if last digit is even (0,2,4,6,8). 50% win rate, ~1.86x payout.',
    contractType: 'DIGITEVEN',
    barrierCount: 0,
    barriers: [],
    expectedWinRate: 0.50,
    duration: 1,
    durationUnit: 't',
  },
  {
    id: 'odd',
    name: 'Odd Digit',
    description: 'DIGITODD — win if last digit is odd (1,3,5,7,9). 50% win rate, ~1.86x payout.',
    contractType: 'DIGITODD',
    barrierCount: 0,
    barriers: [],
    expectedWinRate: 0.50,
    duration: 1,
    durationUnit: 't',
  },
  {
    id: 'match-5',
    name: 'Digit Match (5)',
    description: 'DIGITMATCH — win if last digit equals 5. 10% win rate, ~9.3x payout. High risk, high reward.',
    contractType: 'DIGITMATCH',
    barrierCount: 1,
    barriers: [5],
    expectedWinRate: 0.10,
    duration: 1,
    durationUnit: 't',
  },
  {
    id: 'differ-5',
    name: 'Digit Differ (5)',
    description: 'DIGITDIFF — win if last digit is NOT 5. 90% win rate, ~1.03x payout. Safe, small profit.',
    contractType: 'DIGITDIFF',
    barrierCount: 1,
    barriers: [5],
    expectedWinRate: 0.90,
    duration: 1,
    durationUnit: 't',
  },
];

// ============================================================
// STATE MANAGEMENT
// ============================================================

// Per-strategy barrier cycling index
const strategyBarrierIndex = new Map<string, number>();

function getBarrierIndex(strategyId: string): number {
  if (!strategyBarrierIndex.has(strategyId)) strategyBarrierIndex.set(strategyId, 0);
  return strategyBarrierIndex.get(strategyId)!;
}

function advanceBarrierIndex(strategyId: string, count: number): number {
  const idx = getBarrierIndex(strategyId);
  const val = idx % count;
  strategyBarrierIndex.set(strategyId, idx + 1);
  return val;
}

export function resetBarrierIndex(strategyId?: string): void {
  if (strategyId) {
    strategyBarrierIndex.delete(strategyId);
  } else {
    strategyBarrierIndex.clear();
  }
}

export function createMarketStates(): Map<string, MarketState> {
  const states = new Map<string, MarketState>();
  for (const m of ALL_MARKETS) {
    states.set(m.symbol, {
      symbol: m.symbol, name: m.name, type: m.type, tradable: m.tradable,
      digitHistory: [], priceHistory: [], distribution: new Array(10).fill(0),
      totalTicks: 0, lastTick: null, lastTickTime: 0,
      tradeResults: [], lastTradeTime: 0,
    });
  }
  return states;
}

export function feedTick(state: MarketState, tick: TickData): void {
  state.digitHistory.push(tick.digit);
  if (state.digitHistory.length > 500) state.digitHistory.shift();
  state.priceHistory.push(tick.price);
  if (state.priceHistory.length > 200) state.priceHistory.shift();
  state.distribution[tick.digit]++;
  state.totalTicks++;
  state.lastTick = tick;
  state.lastTickTime = tick.timestamp;
}

export function recordMarketResult(state: MarketState, won: boolean): void {
  state.tradeResults.push(won);
  if (state.tradeResults.length > 100) state.tradeResults.shift();
  state.lastTradeTime = Date.now();
}

export function getMarketWR(state: MarketState): number {
  if (state.tradeResults.length === 0) return 0.5;
  return state.tradeResults.filter(Boolean).length / state.tradeResults.length;
}

export function getMarketConsecutiveLosses(state: MarketState): number {
  let count = 0;
  for (let i = state.tradeResults.length - 1; i >= 0; i--) {
    if (!state.tradeResults[i]) count++;
    else break;
  }
  return count;
}

export function resetMarketSitOut(state: MarketState): void {
  const consec = getMarketConsecutiveLosses(state);
  if (consec >= 3) {
    const toRemove = consec - 1;
    state.tradeResults.splice(0, Math.min(toRemove, state.tradeResults.length));
  }
}

const barrierLosses = new Map<string, number>();
export function recordBarrierResult(contractType: string, barrier: number, won: boolean): void {
  const key = `${contractType}:${barrier}`;
  const current = barrierLosses.get(key) || 0;
  barrierLosses.set(key, won ? 0 : current + 1);
}
export function getBarrierConsecLosses(contractType: string, barrier: number): number {
  return barrierLosses.get(`${contractType}:${barrier}`) || 0;
}
export function resetBarrierLosses(): void { barrierLosses.clear(); }

// === RSI ===

export function computeRSI(prices: number[], period: number = 5): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  if (gains === 0) return 0;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}

export function getRSI(state: MarketState): number {
  if (state.priceHistory.length < 6) return 50;
  return computeRSI(state.priceHistory, 5);
}

// ============================================================
// CORE STRATEGY RUNNER — picks the active strategy and generates a signal
// ============================================================

/**
 * Run the selected strategy. Returns a TradeSignal or null if blocked.
 * @param state - Market state with tick history
 * @param strategyId - Which strategy to run (from STRATEGIES registry)
 */
export function runStrategy(
  state: MarketState,
  strategyId: string,
): TradeSignal | null {
  const strat = STRATEGIES.find(s => s.id === strategyId);
  if (!strat) {
    console.error(`[Strategies] Unknown strategy: ${strategyId}`);
    return null;
  }

  // Need at least 5 ticks
  if (state.totalTicks < 5) return null;

  // Block if 10+ consecutive losses
  const consecutiveLosses = getMarketConsecutiveLosses(state);
  if (consecutiveLosses >= 10) return null;

  const rsi = getRSI(state);
  const recentDigits = state.digitHistory.slice(-20);

  // --- DIGITUNDER 7/8/9 Switcher ---
  if (strat.id === 'under-7-8-9') {
    const idx = advanceBarrierIndex(strat.id, strat.barriers.length);
    const barrier = strat.barriers[idx];
    const expectedWR = barrier / 10;
    const underCount = recentDigits.filter(d => d < barrier).length;
    const recentRate = recentDigits.length > 0 ? underCount / recentDigits.length : expectedWR;
    const confidence = Math.min(0.75, expectedWR + (expectedWR - recentRate > 0.15 ? 0.05 : 0));

    return {
      contractType: 'DIGITUNDER',
      barrier,
      prediction: `Digit UNDER ${barrier}`,
      confidence,
      reason: `UNDER ${barrier} | recent=${(recentRate * 100).toFixed(0)}% | hist=${underCount}/${recentDigits.length}`,
      expectedWinRate: expectedWR,
      rsiValue: rsi,
    };
  }

  // --- DIGITOVER 0/1/2 Switcher ---
  if (strat.id === 'over-0-1-2') {
    const idx = advanceBarrierIndex(strat.id, strat.barriers.length);
    const barrier = strat.barriers[idx];
    const expectedWR = (9 - barrier) / 10;
    const overCount = recentDigits.filter(d => d > barrier).length;
    const recentRate = recentDigits.length > 0 ? overCount / recentDigits.length : expectedWR;
    const confidence = Math.min(0.90, expectedWR + (expectedWR - recentRate > 0.15 ? 0.05 : 0));

    return {
      contractType: 'DIGITOVER',
      barrier,
      prediction: `Digit OVER ${barrier}`,
      confidence,
      reason: `OVER ${barrier} | recent=${(recentRate * 100).toFixed(0)}% | hist=${overCount}/${recentDigits.length}`,
      expectedWinRate: expectedWR,
      rsiValue: rsi,
    };
  }

  // --- DIGITEVEN ---
  if (strat.id === 'even') {
    const evenCount = recentDigits.filter(d => d % 2 === 0).length;
    const recentRate = recentDigits.length > 0 ? evenCount / recentDigits.length : 0.50;
    const confidence = Math.min(0.60, 0.50 + (recentRate < 0.40 ? 0.10 : 0));

    return {
      contractType: 'DIGITEVEN',
      barrier: undefined,
      prediction: 'Even digit (0,2,4,6,8)',
      confidence,
      reason: `EVEN | recent=${(recentRate * 100).toFixed(0)}% | hist=${evenCount}/${recentDigits.length}`,
      expectedWinRate: 0.50,
      rsiValue: rsi,
    };
  }

  // --- DIGITODD ---
  if (strat.id === 'odd') {
    const oddCount = recentDigits.filter(d => d % 2 === 1).length;
    const recentRate = recentDigits.length > 0 ? oddCount / recentDigits.length : 0.50;
    const confidence = Math.min(0.60, 0.50 + (recentRate < 0.40 ? 0.10 : 0));

    return {
      contractType: 'DIGITODD',
      barrier: undefined,
      prediction: 'Odd digit (1,3,5,7,9)',
      confidence,
      reason: `ODD | recent=${(recentRate * 100).toFixed(0)}% | hist=${oddCount}/${recentDigits.length}`,
      expectedWinRate: 0.50,
      rsiValue: rsi,
    };
  }

  // --- DIGITMATCH (5) ---
  if (strat.id === 'match-5') {
    const matchDigit = 5;
    const matchCount = recentDigits.filter(d => d === matchDigit).length;
    const recentRate = recentDigits.length > 0 ? matchCount / recentDigits.length : 0.10;
    const confidence = Math.min(0.25, 0.10 + (recentRate > 0.15 ? 0.10 : 0));

    return {
      contractType: 'DIGITMATCH',
      barrier: matchDigit,
      prediction: `Digit = ${matchDigit}`,
      confidence,
      reason: `MATCH ${matchDigit} | recent=${(recentRate * 100).toFixed(0)}% | hist=${matchCount}/${recentDigits.length}`,
      expectedWinRate: 0.10,
      rsiValue: rsi,
    };
  }

  // --- DIGITDIFF (5) ---
  if (strat.id === 'differ-5') {
    const diffDigit = 5;
    const diffCount = recentDigits.filter(d => d !== diffDigit).length;
    const recentRate = recentDigits.length > 0 ? diffCount / recentDigits.length : 0.90;
    const confidence = Math.min(0.92, 0.90 + (recentRate > 0.95 ? 0.02 : 0));

    return {
      contractType: 'DIGITDIFF',
      barrier: diffDigit,
      prediction: `Digit != ${diffDigit}`,
      confidence,
      reason: `DIFFER ${diffDigit} | recent=${(recentRate * 100).toFixed(0)}% | hist=${diffCount}/${recentDigits.length}`,
      expectedWinRate: 0.90,
      rsiValue: rsi,
    };
  }

  return null;
}

// === Backward compat: runAllStrategies calls the selected strategy ===
export function runAllStrategies(
  state: MarketState,
  _features?: any,
  _priceHistory?: number[],
): TradeSignal | null {
  return runStrategy(state, 'under-7-8-9'); // default
}

// === Score and rank ===

export function scoreAndRank(markets: Map<string, MarketState>): ScoredMarket[] {
  const scored: ScoredMarket[] = [];
  for (const [symbol, state] of markets) {
    const signal = state.tradable ? runAllStrategies(state) : null;
    let score = 0;
    if (signal) {
      score = signal.confidence * 100;
      if (state.tradable) score += 20;
    }
    scored.push({ ...state, score, signal, rank: 0 });
  }
  scored.sort((a, b) => b.score - a.score);
  scored.forEach((m, i) => { m.rank = i + 1; });
  return scored;
}
// v22 multi-strategy

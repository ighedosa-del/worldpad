'use client';

// === Digit Under 7/8/9 Switcher — matches dbtraders "Under 7 8 9 Switcher" ===
// Strategy: DIGITUNDER contract, cycling barriers 7→8→9 on each trade.
// Market: 1HZ100V (Volatility 100 (1s) Index) — 1-second ticks, ideal for digit analysis.
// ALWAYS-ON: trades every cycle after minimum ticks collected.
// D'Alembert stake: $0.40 base, +$0.40 on loss, -$0.40 on win (min $0.40).

import type { TickData } from './types';

// === Market ===
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

// === Barrier Switcher Config ===
const BARRIERS = [7, 8, 9];
let barrierIndex = 0;

// === Types ===

export interface TradeSignal {
  contractType: string;  // 'DIGITUNDER'
  barrier: number;       // 7, 8, or 9
  confidence: number;
  reason: string;
  expectedWinRate: number;
  rsiValue: number;
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
export const CALL_PUT_DURATION = 1;       // 1 tick for digit contracts
export const CALL_PUT_DURATION_UNIT = 't';
export const DALEMBERT_BASE_PCT = 0.01;
export const DAILY_TAKE_PROFIT_PCT = 0.05;
export const DAILY_STOP_LOSS_PCT = 0.15;
export const MIN_PAYOUT_RATIO = 1.10;

// === State Management ===

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
  const key = `${contractType}:${barrier || 0}`;
  const current = barrierLosses.get(key) || 0;
  barrierLosses.set(key, won ? 0 : current + 1);
}
export function getBarrierConsecLosses(contractType: string, barrier: number): number {
  return barrierLosses.get(`${contractType}:${barrier || 0}`) || 0;
}
export function resetBarrierLosses(): void { barrierLosses.clear(); }

// === RSI helper (for display/analysis only) ===

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

// === CORE STRATEGY: Digit Under 7/8/9 Switcher ===
// ALWAYS-ON: returns a signal every cycle (after min ticks).
// Cycles barrier through 7 → 8 → 9 → 7 → 8 → 9...
// Contract: DIGITUNDER (win if last digit < barrier)
//   Barrier 7: 70% chance, payout ~1.43x
//   Barrier 8: 80% chance, payout ~1.25x
//   Barrier 9: 90% chance, payout ~1.11x

export function runAllStrategies(
  state: MarketState,
  _features?: any,
  _priceHistory?: number[],
): TradeSignal | null {
  // Need at least 5 ticks to have some digit data
  if (state.totalTicks < 5) return null;

  // Block if 10+ consecutive losses
  const consecutiveLosses = getMarketConsecutiveLosses(state);
  if (consecutiveLosses >= 10) return null;

  // Cycle through barriers 7, 8, 9
  const barrier = BARRIERS[barrierIndex % BARRIERS.length];
  barrierIndex++;

  // Expected win rate based on barrier (uniform distribution assumption)
  const expectedWR = barrier / 10;

  // Payout ratio for DIGITUNDER
  // Payout ≈ (1 / probability) * (1 - house_edge)
  // For Deriv: payout ≈ barrier * 0.1 * (1/0.07) ≈ simplified
  // Actually Deriv payout for DIGITUNDER barrier N = roughly (10/N) * 0.93
  const payoutRatio = (10 / barrier) * 0.93;

  // Recent digit under rate for this barrier
  const recentDigits = state.digitHistory.slice(-20);
  const underCount = recentDigits.filter(d => d < barrier).length;
  const recentRate = recentDigits.length > 0 ? underCount / recentDigits.length : expectedWR;

  // If recent rate is significantly below expected, boost confidence slightly
  const rateDiff = expectedWR - recentRate;
  const confidenceBoost = rateDiff > 0.15 ? 0.05 : 0;
  const confidence = Math.min(0.75, expectedWR + confidenceBoost);

  const rsi = getRSI(state);

  return {
    contractType: 'DIGITUNDER',
    barrier,
    confidence,
    reason: `UNDER ${barrier} | recent=${(recentRate * 100).toFixed(0)}% | hist=${underCount}/${recentDigits.length}`,
    expectedWinRate: expectedWR,
    rsiValue: rsi,
  };
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
// v20 deploy trigger


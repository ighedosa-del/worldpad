'use client';

// === LUCAS Strategies v3 — DB Traders Style ===
// Matches dbtraders.com bot behavior from user's videos.
// Key features from videos:
//   1. Even/Odd Alternator — alternates DIGITEVEN/DIGITODD every trade
//   2. Even/Odd Alternate on Loss — only switches on loss
//   3. Under/Over Switcher — cycles barriers
//   4. Match/Differ — digit match or differ
//   5. All trades: 1 tick duration, execute every 1-4 seconds
//   6. Martingale multiplier (not D'Alembert)

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

// === Types ===

export interface TradeSignal {
  contractType: string;
  barrier: number | undefined;
  prediction: string;
  confidence: number;
  reason: string;
  expectedWinRate: number;
  rsiValue: number;
}

export interface StrategyDef {
  id: string;
  name: string;
  description: string;
  contractTypes: string[];  // Can use multiple contract types (e.g. EVEN+ODD)
  barriers: number[];      // Barriers to cycle (empty for EVEN/ODD)
  expectedWinRate: number;
  duration: number;
  durationUnit: string;
  alternates: boolean;    // Does it alternate between contract types?
  alternateOnLoss: boolean; // Only alternate on loss?
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

// === Compatibility exports ===
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
// STRATEGY REGISTRY — Matches DB Traders strategies from videos
// ============================================================

export const STRATEGIES: StrategyDef[] = [
  {
    id: 'even-odd-alt',
    name: 'Even/Odd Alternator',
    description: 'Alternates DIGITEVEN and DIGITODD every trade. Like DB Traders "Alternate Even and Odd" toggle. 50% win rate, ~1.86x payout.',
    contractTypes: ['DIGITEVEN', 'DIGITODD'],
    barriers: [],
    expectedWinRate: 0.50,
    duration: 1,
    durationUnit: 't',
    alternates: true,
    alternateOnLoss: false,
  },
  {
    id: 'even-odd-loss',
    name: 'Even/Odd Alternate on Loss',
    description: 'Starts with DIGITEVEN, switches to DIGITODD only on loss, then back on next loss. Like DB Traders "Alternate on Loss" toggle. 50% win rate.',
    contractTypes: ['DIGITEVEN', 'DIGITODD'],
    barriers: [],
    expectedWinRate: 0.50,
    duration: 1,
    durationUnit: 't',
    alternates: true,
    alternateOnLoss: true,
  },
  {
    id: 'under-7-8-9',
    name: 'Under 7/8/9 Switcher',
    description: 'DIGITUNDER cycling barriers 7 -> 8 -> 9. Win if last digit < barrier. 70-90% win rate.',
    contractTypes: ['DIGITUNDER'],
    barriers: [7, 8, 9],
    expectedWinRate: 0.80,
    duration: 1,
    durationUnit: 't',
    alternates: false,
    alternateOnLoss: false,
  },
  {
    id: 'over-0-1-2',
    name: 'Over 0/1/2 Switcher',
    description: 'DIGITOVER cycling barriers 0 -> 1 -> 2. Win if last digit > barrier. 90-100% win rate.',
    contractTypes: ['DIGITOVER'],
    barriers: [0, 1, 2],
    expectedWinRate: 0.90,
    duration: 1,
    durationUnit: 't',
    alternates: false,
    alternateOnLoss: false,
  },
  {
    id: 'even',
    name: 'Even Digit',
    description: 'DIGITEVEN only — win if last digit is even (0,2,4,6,8). 50% win rate, ~1.86x payout.',
    contractTypes: ['DIGITEVEN'],
    barriers: [],
    expectedWinRate: 0.50,
    duration: 1,
    durationUnit: 't',
    alternates: false,
    alternateOnLoss: false,
  },
  {
    id: 'odd',
    name: 'Odd Digit',
    description: 'DIGITODD only — win if last digit is odd (1,3,5,7,9). 50% win rate, ~1.86x payout.',
    contractTypes: ['DIGITODD'],
    barriers: [],
    expectedWinRate: 0.50,
    duration: 1,
    durationUnit: 't',
    alternates: false,
    alternateOnLoss: false,
  },
  {
    id: 'differ-5',
    name: 'Digit Differ (5)',
    description: 'DIGITDIFF — win if last digit is NOT 5. 90% win rate, ~1.03x payout. Safe, small profit per trade.',
    contractTypes: ['DIGITDIFF'],
    barriers: [5],
    expectedWinRate: 0.90,
    duration: 1,
    durationUnit: 't',
    alternates: false,
    alternateOnLoss: false,
  },
  {
    id: 'match-5',
    name: 'Digit Match (5)',
    description: 'DIGITMATCH — win if last digit equals 5. 10% win rate, ~9.3x payout. High risk, high reward.',
    contractTypes: ['DIGITMATCH'],
    barriers: [5],
    expectedWinRate: 0.10,
    duration: 1,
    durationUnit: 't',
    alternates: false,
    alternateOnLoss: false,
  },
];

// ============================================================
// STATE — track which contract/barrier to use next per strategy
// ============================================================

// Tracks the current index for strategies that alternate or cycle
const strategyState = new Map<string, { contractIdx: number; barrierIdx: number; lastWon: boolean | null }>();

function getStrategyState(id: string) {
  if (!strategyState.has(id)) {
    strategyState.set(id, { contractIdx: 0, barrierIdx: 0, lastWon: null });
  }
  return strategyState.get(id)!;
}

export function resetBarrierIndex(strategyId?: string): void {
  if (strategyId) strategyState.delete(strategyId);
  else strategyState.clear();
}

// Called after each trade result to update alternation state
export function reportTradeResult(strategyId: string, won: boolean): void {
  const st = getStrategyState(strategyId);
  st.lastWon = won;

  const strat = STRATEGIES.find(s => s.id === strategyId);
  if (!strat) return;

  // If alternateOnLoss and loss, switch contract type
  if (strat.alternateOnLoss && !won) {
    st.contractIdx = (st.contractIdx + 1) % strat.contractTypes.length;
  }
}

// ============================================================
// MARKET STATE
// ============================================================

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
// CORE STRATEGY RUNNER
// ============================================================

export function runStrategy(
  state: MarketState,
  strategyId: string,
): TradeSignal | null {
  const strat = STRATEGIES.find(s => s.id === strategyId);
  if (!strat) return null;

  // Need at least 3 ticks (fast start)
  if (state.totalTicks < 3) return null;

  // Block if 10+ consecutive losses
  const consecutiveLosses = getMarketConsecutiveLosses(state);
  if (consecutiveLosses >= 10) return null;

  const rsi = getRSI(state);
  const recentDigits = state.digitHistory.slice(-20);
  const st = getStrategyState(strategyId);

  // --- Strategies with barrier cycling (UNDER/OVER) ---
  if (strat.barriers.length > 0 && !strat.alternates) {
    const barrier = strat.barriers[st.barrierIdx % strat.barriers.length];
    st.barrierIdx++;

    const contractType = strat.contractTypes[0];
    const isUnder = contractType === 'DIGITUNDER';
    const expectedWR = isUnder ? barrier / 10 : (9 - barrier) / 10;
    const relevantDigits = isUnder
      ? recentDigits.filter(d => d < barrier).length
      : recentDigits.filter(d => d > barrier).length;
    const recentRate = recentDigits.length > 0 ? relevantDigits / recentDigits.length : expectedWR;
    const label = isUnder ? 'UNDER' : (contractType === 'DIGITMATCH' ? 'MATCH' : contractType === 'DIGITDIFF' ? 'DIFFER' : 'OVER');

    return {
      contractType,
      barrier,
      prediction: `${label} ${barrier}`,
      confidence: Math.min(0.90, expectedWR),
      reason: `${label} ${barrier} | recent=${(recentRate * 100).toFixed(0)}% (${relevantDigits}/${recentDigits.length})`,
      expectedWinRate: expectedWR,
      rsiValue: rsi,
    };
  }

  // --- Even/Odd Alternator (always alternate) ---
  if (strat.id === 'even-odd-alt') {
    const contractType = strat.contractTypes[st.contractIdx % strat.contractTypes.length];
    st.contractIdx++;
    const isEven = contractType === 'DIGITEVEN';
    const evenCount = recentDigits.filter(d => d % 2 === 0).length;
    const recentRate = recentDigits.length > 0 ? (isEven ? evenCount / recentDigits.length : 1 - evenCount / recentDigits.length) : 0.50;

    return {
      contractType,
      barrier: undefined,
      prediction: isEven ? 'Even digit' : 'Odd digit',
      confidence: 0.55,
      reason: `${isEven ? 'EVEN' : 'ODD'} | recent even=${(evenCount / (recentDigits.length || 1) * 100).toFixed(0)}%`,
      expectedWinRate: 0.50,
      rsiValue: rsi,
    };
  }

  // --- Even/Odd Alternate on Loss ---
  if (strat.id === 'even-odd-loss') {
    const contractType = strat.contractTypes[st.contractIdx % strat.contractTypes.length];
    const isEven = contractType === 'DIGITEVEN';
    const evenCount = recentDigits.filter(d => d % 2 === 0).length;

    return {
      contractType,
      barrier: undefined,
      prediction: isEven ? 'Even digit' : 'Odd digit',
      confidence: 0.55,
      reason: `${isEven ? 'EVEN' : 'ODD'} (alt on loss) | even rate=${(evenCount / (recentDigits.length || 1) * 100).toFixed(0)}%`,
      expectedWinRate: 0.50,
      rsiValue: rsi,
    };
  }

  // --- Single contract strategies (even, odd) ---
  if (strat.contractTypes.length === 1 && strat.barriers.length === 0) {
    const contractType = strat.contractTypes[0];
    const isEven = contractType === 'DIGITEVEN';
    const evenCount = recentDigits.filter(d => d % 2 === 0).length;
    const recentRate = recentDigits.length > 0
      ? (isEven ? evenCount / recentDigits.length : 1 - evenCount / recentDigits.length)
      : 0.50;

    return {
      contractType,
      barrier: undefined,
      prediction: isEven ? 'Even digit' : 'Odd digit',
      confidence: 0.55,
      reason: `${isEven ? 'EVEN' : 'ODD'} | recent=${(recentRate * 100).toFixed(0)}%`,
      expectedWinRate: 0.50,
      rsiValue: rsi,
    };
  }

  return null;
}

// === Backward compat ===
export function runAllStrategies(state: MarketState, _features?: any, _priceHistory?: number[]): TradeSignal | null {
  return runStrategy(state, 'under-7-8-9');
}

// === Score and rank ===

export function scoreAndRank(markets: Map<string, MarketState>): ScoredMarket[] {
  const scored: ScoredMarket[] = [];
  for (const [symbol, state] of markets) {
    const signal = state.tradable ? runAllStrategies(state) : null;
    let score = 0;
    if (signal) { score = signal.confidence * 100; if (state.tradable) score += 20; }
    scored.push({ ...state, score, signal, rank: 0 });
  }
  scored.sort((a, b) => b.score - a.score);
  scored.forEach((m, i) => { m.rank = i + 1; });
  return scored;
}
// v23 dbtraders-style strategies

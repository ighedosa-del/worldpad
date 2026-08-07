'use client';

// === Trading Strategies v2 ===
// Pure functions. No React. No closures.
// Each strategy analyzes digit history and returns a signal or null.

import type { TickData } from './deriv-client';

export const SCANNED_MARKETS = [
  { symbol: 'R_10', name: 'Volatility 10 Index', type: 'fast' as const },
  { symbol: 'R_25', name: 'Volatility 25 Index', type: 'fast' as const },
  { symbol: 'R_50', name: 'Volatility 50 Index', type: 'fast' as const },
  { symbol: 'R_75', name: 'Volatility 75 Index', type: 'fast' as const },
  { symbol: 'R_100', name: 'Volatility 100 Index', type: 'standard' as const },
] as const;

export type MarketSymbol = (typeof SCANNED_MARKETS)[number]['symbol'];

export interface TradeSignal {
  contractType: string;
  barrier: number | undefined;
  confidence: number;
  reason: string;
}

export interface MarketState {
  symbol: string;
  name: string;
  type: 'fast' | 'standard';
  digitHistory: number[];
  distribution: number[];  // 10-element array, distribution[0] = count of 0s
  totalTicks: number;
  lastTick: TickData | null;
  lastTickTime: number;
}

export interface ScoredMarket extends MarketState {
  score: number;
  signal: TradeSignal | null;
  rank: number;
}

// Initialize market states
export function createMarketStates(): Map<string, MarketState> {
  const states = new Map<string, MarketState>();
  for (const m of SCANNED_MARKETS) {
    states.set(m.symbol, {
      symbol: m.symbol,
      name: m.name,
      type: m.type,
      digitHistory: [],
      distribution: new Array(10).fill(0),
      totalTicks: 0,
      lastTick: null,
      lastTickTime: 0,
    });
  }
  return states;
}

// Feed a tick into a market's state
export function feedTick(state: MarketState, tick: TickData): void {
  state.digitHistory.push(tick.digit);
  if (state.digitHistory.length > 500) {
    state.digitHistory.shift();
  }
  state.distribution[tick.digit]++;
  state.totalTicks++;
  state.lastTick = tick;
  state.lastTickTime = tick.timestamp;
}

// === Strategy 1: Digit Frequency Analysis (DIGITDIFF) ===
// Find the digit that has appeared MOST frequently and bet DIFF against it.
// Rationale: over time, digits should converge to uniform 10%. 
// If a digit is overrepresented, it should regress.
export function strategyFrequencyDiff(state: MarketState): TradeSignal | null {
  const minTicks = 30;
  if (state.totalTicks < minTicks) return null;

  const total = state.totalTicks;
  const expected = total / 10;
  let maxDigit = 0;
  let maxCount = 0;

  for (let d = 0; d < 10; d++) {
    if (state.distribution[d] > maxCount) {
      maxCount = state.distribution[d];
      maxDigit = d;
    }
  }

  // Only signal if the digit is significantly overrepresented
  const overPct = ((maxCount / total) - 0.1) * 100; // how many % above expected
  if (overPct < 3) return null; // need at least 3% above 10% to trigger

  const confidence = Math.min(0.95, 0.5 + overPct / 20);

  return {
    contractType: 'DIGITDIFF',
    barrier: maxDigit,
    confidence,
    reason: `FreqDiff: digit ${maxDigit} at ${(maxCount/total*100).toFixed(1)}% (expected 10%), over by ${overPct.toFixed(1)}pp`,
  };
}

// === Strategy 2: Last-N Repeating Pattern (DIGITMATCH) ===
// If the same digit appeared 2+ times in last 3 ticks, bet MATCH on it.
export function strategyRepeatMatch(state: MarketState): TradeSignal | null {
  const h = state.digitHistory;
  if (h.length < 5) return null;

  const last3 = h.slice(-3);
  // Check if 2 out of last 3 are the same
  if (last3[1] === last3[2] && last3[0] !== last3[1]) {
    return {
      contractType: 'DIGITMATCH',
      barrier: last3[1],
      confidence: 0.65,
      reason: `RepeatMatch: ${last3[1]} appeared 2x in last 3 ticks`,
    };
  }
  return null;
}

// === Strategy 3: Alternating Pattern (DIGITDIFF) ===
// If last 4+ digits alternate even-odd, bet DIFF against the expected next.
export function strategyAlternating(state: MarketState): TradeSignal | null {
  const h = state.digitHistory;
  if (h.length < 6) return null;

  let alternating = true;
  const last4 = h.slice(-4);
  for (let i = 1; i < last4.length; i++) {
    if ((last4[i] % 2) === (last4[i - 1] % 2)) {
      alternating = false;
      break;
    }
  }

  if (!alternating) return null;

  const lastDigit = h[h.length - 1];
 const nextExpected = lastDigit % 2 === 0 ? 1 : 0; // opposite parity
  // Find the least common digit of that parity as barrier
  let bestDigit = nextExpected;
  let bestCount = Infinity;
  for (let d = nextExpected; d < 10; d += 2) {
    if (state.distribution[d] < bestCount) {
      bestCount = state.distribution[d];
      bestDigit = d;
    }
  }

  return {
    contractType: 'DIGITDIFF',
    barrier: bestDigit,
    confidence: 0.6,
    reason: `Alternating: last 4 alternate E/O, diff against ${bestDigit} (rarest ${nextExpected === 0 ? 'even' : 'odd'})`,
  };
}

// === Strategy 4: Streak Break (DIGITDIFF) ===
// If a digit appeared 3+ consecutive times, bet DIFF against it.
export function strategyStreakBreak(state: MarketState): TradeSignal | null {
  const h = state.digitHistory;
  if (h.length < 4) return null;

  const last = h[h.length - 1];
  let streak = 1;
  for (let i = h.length - 2; i >= 0; i--) {
    if (h[i] === last) streak++;
    else break;
  }

  if (streak < 3) return null;

  const confidence = Math.min(0.92, 0.6 + streak * 0.08);

  return {
    contractType: 'DIGITDIFF',
    barrier: last,
    confidence,
    reason: `StreakBreak: digit ${last} streak of ${streak}, betting against continuation`,
  };
}

// === Strategy 5: Underrepresented Digit (DIGITMATCH) ===
// If a digit is severely underrepresented, bet it will appear.
export function strategyUnderrepresented(state: MarketState): TradeSignal | null {
  const minTicks = 50;
  if (state.totalTicks < minTicks) return null;

  const total = state.totalTicks;
  const expected = total / 10;
  let minDigit = 0;
  let minCount = Infinity;

  for (let d = 0; d < 10; d++) {
    if (state.distribution[d] < minCount) {
      minCount = state.distribution[d];
      minDigit = d;
    }
  }

  const underPct = (0.1 - minCount / total) * 100;
  if (underPct < 4) return null; // need at least 4% below expected

  const confidence = Math.min(0.85, 0.45 + underPct / 15);

  return {
    contractType: 'DIGITMATCH',
    barrier: minDigit,
    confidence,
    reason: `UnderRep: digit ${minDigit} at ${(minCount/total*100).toFixed(1)}%, under by ${underPct.toFixed(1)}pp`,
  };
}

// === Run all strategies on a market, return best signal ===
const ALL_STRATEGIES = [
  strategyStreakBreak,
  strategyFrequencyDiff,
  strategyRepeatMatch,
  strategyAlternating,
  strategyUnderrepresented,
];

export function runAllStrategies(state: MarketState): TradeSignal | null {
  let bestSignal: TradeSignal | null = null;

  for (const strategy of ALL_STRATEGIES) {
    const signal = strategy(state);
    if (!signal) continue;

    // Prefer DIGITDIFF over DIGITMATCH (higher win rate ~90% vs ~10%)
    if (!bestSignal) {
      bestSignal = signal;
    } else {
      // DIGITDIFF is almost always better EV
      if (signal.contractType === 'DIGITDIFF' && bestSignal.contractType !== 'DIGITDIFF') {
        bestSignal = signal;
      } else if (signal.confidence > bestSignal.confidence) {
        bestSignal = signal;
      }
    }
  }

  return bestSignal;
}

// === Score all markets and rank them ===
export function scoreAndRank(markets: Map<string, MarketState>): ScoredMarket[] {
  const scored: ScoredMarket[] = [];

  for (const [, state] of markets) {
    const signal = runAllStrategies(state);
    let score = 0;

    if (signal) {
      // Base score from confidence
      score = signal.confidence * 100;

      // Bonus for DIGITDIFF (higher win rate)
      if (signal.contractType === 'DIGITDIFF') score += 15;

      // Bonus for more data
      if (state.totalTicks > 100) score += 5;
      if (state.totalTicks > 200) score += 5;
    }

    scored.push({
      ...state,
      score,
      signal,
      rank: 0,
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Assign ranks
  scored.forEach((m, i) => { m.rank = i + 1; });

  return scored;
}

'use client';

// === Trading Strategies v3 — Enhanced ===
// Pure functions. No React. No closures.
// Each strategy analyzes digit history and returns a signal or null.
// v3: Added consensus scoring, Markov-transition strategy, pair analysis,
//     and improved signal confidence calibration.

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
export function strategyFrequencyDiff(state: MarketState): TradeSignal | null {
  const minTicks = 30;
  if (state.totalTicks < minTicks) return null;

  const total = state.totalTicks;
  let maxDigit = 0;
  let maxCount = 0;

  for (let d = 0; d < 10; d++) {
    if (state.distribution[d] > maxCount) {
      maxCount = state.distribution[d];
      maxDigit = d;
    }
  }

  const overPct = ((maxCount / total) - 0.1) * 100;
  if (overPct < 2.5) return null; // slightly more sensitive

  const confidence = Math.min(0.95, 0.5 + overPct / 18);

  return {
    contractType: 'DIGITDIFF',
    barrier: maxDigit,
    confidence,
    reason: `FreqDiff: d${maxDigit} at ${(maxCount/total*100).toFixed(1)}% (over ${overPct.toFixed(1)}pp)`,
  };
}

// === Strategy 2: Last-N Repeating Pattern (DIGITMATCH) ===
export function strategyRepeatMatch(state: MarketState): TradeSignal | null {
  const h = state.digitHistory;
  if (h.length < 5) return null;

  const last3 = h.slice(-3);
  if (last3[1] === last3[2] && last3[0] !== last3[1]) {
    return {
      contractType: 'DIGITMATCH',
      barrier: last3[1],
      confidence: 0.65,
      reason: `RepeatMatch: d${last3[1]} 2x in last 3`,
    };
  }
  return null;
}

// === Strategy 3: Alternating Pattern (DIGITDIFF) ===
export function strategyAlternating(state: MarketState): TradeSignal | null {
  const h = state.digitHistory;
  if (h.length < 6) return null;

  const last4 = h.slice(-4);
  let alternating = true;
  for (let i = 1; i < last4.length; i++) {
    if ((last4[i] % 2) === (last4[i - 1] % 2)) {
      alternating = false;
      break;
    }
  }

  if (!alternating) return null;

  const lastDigit = h[h.length - 1];
  const nextExpected = lastDigit % 2 === 0 ? 1 : 0;
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
    confidence: 0.65,
    reason: `Alternating: 4 E/O, diff d${bestDigit}`,
  };
}

// === Strategy 4: Streak Break (DIGITDIFF) ===
export function strategyStreakBreak(state: MarketState): TradeSignal | null {
  const h = state.digitHistory;
  if (h.length < 4) return null;

  const last = h[h.length - 1];
  let streak = 1;
  for (let i = h.length - 2; i >= 0; i--) {
    if (h[i] === last) streak++;
    else break;
  }

  if (streak < 2) return null; // lowered from 3 — catch streaks earlier

  const confidence = Math.min(0.95, 0.55 + streak * 0.10);

  return {
    contractType: 'DIGITDIFF',
    barrier: last,
    confidence,
    reason: `StreakBreak: d${last} x${streak}`,
  };
}

// === Strategy 5: Underrepresented Digit (DIGITDIFF, not MATCH) ===
// v3: Changed to DIGITDIFF against the OVER-represented digit
// (more profitable — 90% win rate vs 10% for MATCH)
export function strategyUnderrepresented(state: MarketState): TradeSignal | null {
  const minTicks = 50;
  if (state.totalTicks < minTicks) return null;

  const total = state.totalTicks;
  let minDigit = 0, minCount = Infinity;
  let maxDigit = 0, maxCount = 0;

  for (let d = 0; d < 10; d++) {
    if (state.distribution[d] < minCount) { minCount = state.distribution[d]; minDigit = d; }
    if (state.distribution[d] > maxCount) { maxCount = state.distribution[d]; maxDigit = d; }
  }

  const spread = ((maxCount - minCount) / total) * 100;
  if (spread < 5) return null;

  // DIFF against the over-represented digit (profitable)
  const confidence = Math.min(0.90, 0.45 + spread / 15);

  return {
    contractType: 'DIGITDIFF',
    barrier: maxDigit,
    confidence,
    reason: `Spread: d${maxDigit} ${(maxCount/total*100).toFixed(1)}% vs d${minDigit} ${(minCount/total*100).toFixed(1)}%`,
  };
}

// === Strategy 6: Pair Transition Analysis (NEW) ===
// Looks at the most common digit pairs and predicts based on last digit
export function strategyPairTransition(state: MarketState): TradeSignal | null {
  const h = state.digitHistory;
  if (h.length < 60) return null;

  const recent = h.slice(-150);
  // Count transitions: prevDigit -> nextDigit
  const transitions = Array.from({ length: 10 }, () => new Array(10).fill(0));
  for (let i = 1; i < recent.length; i++) {
    transitions[recent[i - 1]][recent[i]]++;
  }

  const lastDigit = h[h.length - 1];
  const row = transitions[lastDigit];
  const rowTotal = row.reduce((a, b) => a + b, 0);
  if (rowTotal < 5) return null;

  // Find least likely next digit (best for DIFF)
  let minP = Infinity, minD = 0;
  for (let d = 0; d < 10; d++) {
    const p = row[d] / rowTotal;
    if (p < minP) { minP = p; minD = d; }
  }

  // Only signal if the least likely digit is significantly underrepresented
  if (minP > 0.06) return null; // need to be below 6% (expected 10%)

  return {
    contractType: 'DIGITDIFF',
    barrier: minD,
    confidence: Math.min((0.10 - minP) / 0.08, 0.90),
    reason: `PairTrans: d${lastDigit}->d${minD} only ${(minP*100).toFixed(1)}%`,
  };
}

// === Strategy 7: Gap Exploitation (NEW) ===
// If a digit hasn't appeared for a long time, it's "overdue"
// But for DIFF, we exploit the MOST FREQUENT recent digit
export function strategyGapExploit(state: MarketState): TradeSignal | null {
  const h = state.digitHistory;
  if (h.length < 30) return null;

  const lastSeen = new Array(10).fill(-1);
  for (let i = 0; i < h.length; i++) lastSeen[h[i]] = i;

  // Find the digit with the longest gap
  const gaps = lastSeen.map(pos => h.length - 1 - pos);
  const maxGap = Math.max(...gaps);
  if (maxGap < 20) return null;

  // Also find the digit that appeared most in the LAST 10 ticks
  const recent10 = h.slice(-10);
  const recentCounts = new Array(10).fill(0);
  for (const d of recent10) recentCounts[d]++;
  const hotDigit = recentCounts.indexOf(Math.max(...recentCounts));

  if (recentCounts[hotDigit] < 3) return null;

  return {
    contractType: 'DIGITDIFF',
    barrier: hotDigit,
    confidence: Math.min(0.85, 0.5 + recentCounts[hotDigit] * 0.1),
    reason: `GapExploit: d${gaps.indexOf(maxGap)} gap=${maxGap}, hot d${hotDigit}=${recentCounts[hotDigit]}x/10`,
  };
}

// === Run all strategies with consensus ===
const ALL_STRATEGIES = [
  strategyStreakBreak,
  strategyFrequencyDiff,
  strategyGapExploit,
  strategyPairTransition,
  strategyAlternating,
  strategyUnderrepresented,
  strategyRepeatMatch, // lowest priority (DIGITMATCH is risky)
];

export function runAllStrategies(state: MarketState): TradeSignal | null {
  const signals: TradeSignal[] = [];

  for (const strategy of ALL_STRATEGIES) {
    const signal = strategy(state);
    if (signal) signals.push(signal);
  }

  if (signals.length === 0) return null;

  // Separate DIFF signals (high priority) from MATCH signals
  const diffSignals = signals.filter(s => s.contractType === 'DIGITDIFF');
  const matchSignals = signals.filter(s => s.contractType === 'DIGITMATCH');

  // Prefer DIGITDIFF — always
  if (diffSignals.length > 0) {
    // Check for consensus: do multiple strategies agree on the same barrier?
    const barrierVotes = new Map<number, { totalConf: number; count: number; reasons: string[] }>();
    for (const s of diffSignals) {
      if (s.barrier === undefined) continue;
      const existing = barrierVotes.get(s.barrier);
      if (existing) {
        existing.totalConf += s.confidence;
        existing.count++;
        existing.reasons.push(s.reason);
      } else {
        barrierVotes.set(s.barrier, { totalConf: s.confidence, count: 1, reasons: [s.reason] });
      }
    }

    // Find consensus winner
    let bestBarrier = 0, bestScore = 0, bestInfo = barrierVotes.values().next().value;
    for (const [barrier, info] of barrierVotes) {
      // Score = total confidence * (1 + consensus bonus)
      const consensusBonus = info.count >= 3 ? 0.3 : info.count >= 2 ? 0.15 : 0;
      const score = info.totalConf * (1 + consensusBonus);
      if (score > bestScore) {
        bestScore = score;
        bestBarrier = barrier;
        bestInfo = info;
      }
    }

    const finalConfidence = Math.min(bestScore / diffSignals.length + 0.2, 0.98);
    const consensusTag = bestInfo.count >= 2 ? `[${bestInfo.count}x consensus] ` : '';

    return {
      contractType: 'DIGITDIFF',
      barrier: bestBarrier,
      confidence: finalConfidence,
      reason: `${consensusTag}${bestInfo.reasons[0]}${bestInfo.reasons.length > 1 ? ' +' + (bestInfo.reasons.length - 1) + 'more' : ''}`,
    };
  }

  // Only fall back to MATCH if no DIFF signals
  if (matchSignals.length > 0) {
    return matchSignals.reduce((best, s) => s.confidence > best.confidence ? s : best);
  }

  return null;
}

// === Score all markets and rank them ===
export function scoreAndRank(markets: Map<string, MarketState>): ScoredMarket[] {
  const scored: ScoredMarket[] = [];

  for (const [, state] of markets) {
    const signal = runAllStrategies(state);
    let score = 0;

    if (signal) {
      score = signal.confidence * 100;
      if (signal.contractType === 'DIGITDIFF') score += 15;
      if (state.totalTicks > 100) score += 5;
      if (state.totalTicks > 200) score += 5;

      // Bonus for consensus in the signal reason
      if (signal.reason.includes('consensus')) score += 10;
    }

    scored.push({
      ...state,
      score,
      signal,
      rank: 0,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  scored.forEach((m, i) => { m.rank = i + 1; });

  return scored;
}

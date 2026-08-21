'use client';

// === Trading Strategies v4 — Multi-Contract Overhaul ===
// Supports: DIGITDIFF, DIGITMATCH, DIGITOVER, DIGITUNDER
// Key fixes:
//   - Rolling window analysis (not all-time distribution)
//   - OVER/UNDER re-added with proper barriers
//   - Higher confidence thresholds to avoid bad trades
//   - Per-market trade history for adaptive behavior

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
  expectedWinRate: number; // v4: what WR we expect based on analysis
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
  // v4: Per-market trade tracking
  tradeResults: boolean[]; // true=win, false=loss (last 50)
  lastTradeTime: number;
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
      tradeResults: [],
      lastTradeTime: 0,
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

// v4: Record trade result for per-market adaptive behavior
export function recordMarketResult(state: MarketState, won: boolean): void {
  state.tradeResults.push(won);
  if (state.tradeResults.length > 50) state.tradeResults.shift();
  state.lastTradeTime = Date.now();
}

// v4: Get per-market rolling WR
export function getMarketWR(state: MarketState): number {
  if (state.tradeResults.length === 0) return 0.5;
  return state.tradeResults.filter(Boolean).length / state.tradeResults.length;
}

// v4: Get consecutive losses for this market
export function getMarketConsecutiveLosses(state: MarketState): number {
  let count = 0;
  for (let i = state.tradeResults.length - 1; i >= 0; i--) {
    if (!state.tradeResults[i]) count++;
    else break;
  }
  return count;
}

// === Helper: Rolling window distribution ===
function rollingDist(history: number[], window: number): number[] {
  const recent = history.slice(-window);
  const dist = new Array(10).fill(0);
  for (const d of recent) dist[d]++;
  return dist;
}

// === DIFF STRATEGIES ===
// DIFF = bet that next digit will NOT equal barrier
// ~90% base probability. Payout ~$0.05-0.10 on $0.35 stake (very thin margin)
// Need the selected digit to be appearing MORE than 10% to have an edge

// Strategy 1: Rolling Hot Digit DIFF
// If a digit is appearing way more than 10% in the last 30 ticks, DIFF against it
export function strategyRollingHotDiff(state: MarketState): TradeSignal | null {
  if (state.totalTicks < 30) return null;

  const window = 30;
  const dist = rollingDist(state.digitHistory, window);
  const total = window;

  // Find the hottest digit in recent window
  let maxDigit = 0, maxCount = 0;
  for (let d = 0; d < 10; d++) {
    if (dist[d] > maxCount) { maxCount = dist[d]; maxDigit = d; }
  }

  const pct = maxCount / total;
  // Need significantly above 10% to have edge. 5/30 = 16.7% is strong
  if (pct < 0.167) return null;

  // Expected WR for DIFF against this digit = 1 - pct
  const expectedWR = 1 - pct;
  const confidence = Math.min((pct - 0.10) / 0.15, 0.95);

  return {
    contractType: 'DIGITDIFF',
    barrier: maxDigit,
    confidence,
    expectedWinRate: expectedWR,
    reason: `HotDiff: d${maxDigit} ${maxCount}/${total} (${(pct*100).toFixed(0)}%)`,
  };
}

// Strategy 2: Streak Break DIFF
// If same digit appeared 2+ times in a row, DIFF against it (gambler's fallacy or real mean reversion?)
export function strategyStreakDiff(state: MarketState): TradeSignal | null {
  const h = state.digitHistory;
  if (h.length < 4) return null;

  const last = h[h.length - 1];
  let streak = 1;
  for (let i = h.length - 2; i >= 0; i--) {
    if (h[i] === last) streak++;
    else break;
  }

  // Need at least 2x streak (higher streak = stronger signal)
  if (streak < 2) return null;

  // Check if this digit also appears frequently in last 20
  const dist20 = rollingDist(h, 20);
  const freq20 = dist20[last] / 20;

  // Expected WR for DIFF = 1 - probability of this digit appearing again
  // After streak of N, empirical probability of continuation decreases
  const expectedWR = Math.min(0.98, 0.90 + streak * 0.02);
  const confidence = Math.min(0.55 + streak * 0.12, 0.95);

  return {
    contractType: 'DIGITDIFF',
    barrier: last,
    confidence,
    expectedWinRate: expectedWR,
    reason: `StreakDiff: d${last} x${streak} (freq20=${(freq20*100).toFixed(0)}%)`,
  };
}

// Strategy 3: Transition-based DIFF
// Based on Markov transitions: find which digit is LEAST likely to follow the last digit
export function strategyTransitionDiff(state: MarketState): TradeSignal | null {
  const h = state.digitHistory;
  if (h.length < 60) return null;

  const recent = h.slice(-100);
  const transitions = Array.from({ length: 10 }, () => new Array(10).fill(0));
  for (let i = 1; i < recent.length; i++) {
    transitions[recent[i - 1]][recent[i]]++;
  }

  const lastDigit = h[h.length - 1];
  const row = transitions[lastDigit];
  const rowTotal = row.reduce((a, b) => a + b, 0);
  if (rowTotal < 8) return null;

  // Find least likely next digit
  let minP = Infinity, minD = 0;
  for (let d = 0; d < 10; d++) {
    const p = row[d] / rowTotal;
    if (p < minP) { minP = p; minD = d; }
  }

  // Only if significantly below 10%
  if (minP > 0.05) return null;

  // DIFF against this digit: WR = 1 - minP
  const expectedWR = 1 - minP;
  const confidence = Math.min((0.10 - minP) / 0.07, 0.92);

  return {
    contractType: 'DIGITDIFF',
    barrier: minD,
    confidence,
    expectedWinRate: expectedWR,
    reason: `TransDiff: d${lastDigit}->d${minD} ${(minP*100).toFixed(1)}%`,
  };
}

// Strategy 4: Cluster DIFF
// If a digit appeared 3+ times in last 10 ticks, DIFF against it
export function strategyClusterDiff(state: MarketState): TradeSignal | null {
  if (state.totalTicks < 15) return null;

  const recent10 = state.digitHistory.slice(-10);
  const counts = new Array(10).fill(0);
  for (const d of recent10) counts[d]++;

  let maxCount = 0, maxDigit = 0;
  for (let d = 0; d < 10; d++) {
    if (counts[d] > maxCount) { maxCount = counts[d]; maxDigit = d; }
  }

  if (maxCount < 3) return null;

  const pct = maxCount / 10;
  const expectedWR = 1 - pct;
  const confidence = Math.min((pct - 0.10) / 0.20, 0.90);

  return {
    contractType: 'DIGITDIFF',
    barrier: maxDigit,
    confidence,
    expectedWinRate: expectedWR,
    reason: `ClusterDiff: d${maxDigit} ${maxCount}x/10`,
  };
}


// === MATCH STRATEGIES ===
// MATCH = bet that next digit WILL equal barrier
// ~10% base probability. Payout ~8-9x stake.
// Very risky but high reward. Only use with strong patterns.

// Strategy 5: Triple Repeat MATCH
// If same digit appeared 3+ times in a row, MATCH on it continuing
export function strategyTripleRepeatMatch(state: MarketState): TradeSignal | null {
  const h = state.digitHistory;
  if (h.length < 5) return null;

  const last = h[h.length - 1];
  let streak = 1;
  for (let i = h.length - 2; i >= 0; i--) {
    if (h[i] === last) streak++;
    else break;
  }

  // Need 3+ streak for MATCH (high risk)
  if (streak < 3) return null;

  // Probability of 4th consecutive is low, but payout is ~9x
  // Only worth it at 4+ streak
  const confidence = Math.min(0.3 + streak * 0.10, 0.70);

  return {
    contractType: 'DIGITMATCH',
    barrier: last,
    confidence,
    expectedWinRate: 0.10, // base probability
    reason: `TripleMatch: d${last} x${streak}`,
  };
}

// Strategy 6: Dominant Transition MATCH
// If last digit X transitions to digit Y >20% of the time, MATCH on Y
export function strategyDominantTransitionMatch(state: MarketState): TradeSignal | null {
  const h = state.digitHistory;
  if (h.length < 80) return null;

  const recent = h.slice(-150);
  const transitions = Array.from({ length: 10 }, () => new Array(10).fill(0));
  for (let i = 1; i < recent.length; i++) {
    transitions[recent[i - 1]][recent[i]]++;
  }

  const lastDigit = h[h.length - 1];
  const row = transitions[lastDigit];
  const rowTotal = row.reduce((a, b) => a + b, 0);
  if (rowTotal < 8) return null;

  // Find MOST likely next digit
  let maxP = 0, maxD = 0;
  for (let d = 0; d < 10; d++) {
    const p = row[d] / rowTotal;
    if (p > maxP) { maxP = p; maxD = d; }
  }

  // Need significantly above 10% to justify MATCH (payout ~9x means need >11.1% WR to profit)
  // 20% = strong signal
  if (maxP < 0.20) return null;

  const confidence = Math.min((maxP - 0.10) / 0.15, 0.80);

  return {
    contractType: 'DIGITMATCH',
    barrier: maxD,
    confidence,
    expectedWinRate: maxP,
    reason: `DomTransMatch: d${lastDigit}->d${maxD} ${(maxP*100).toFixed(1)}%`,
  };
}


// === OVER/UNDER STRATEGIES ===
// DIGITOVER dN = win if last digit > N. Base prob = (9-N)/10
// DIGITUNDER dN = win if last digit < N. Base prob = (N+1)/10
// OVER d4/UNDER d5 have 50% base prob, payout ~1.9x
// OVER d2/UNDER d7 have 70% base prob, payout ~1.2x
// OVER d0/UNDER d9 have 90% base prob, payout ~1.05x

// Strategy 7: Digit Mean Reversion OVER/UNDER
// If recent digits have been mostly low, bet OVER. If mostly high, bet UNDER.
export function strategyMeanReversionOU(state: MarketState): TradeSignal | null {
  if (state.totalTicks < 40) return null;

  // Look at last 20 digits
  const recent = state.digitHistory.slice(-20);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;

  // Also look at last 50 for broader context
  const recent50 = state.digitHistory.slice(-50);
  const mean50 = recent50.reduce((a, b) => a + b, 0) / recent50.length;

  // If short-term mean is significantly different from long-term mean
  const diff = mean - mean50;

  if (diff < -1.0) {
    // Recent digits are much lower than average → bet OVER (mean reversion)
    // Pick barrier: if mean is ~3, OVER d3 has 60% base prob
    const barrier = Math.max(0, Math.min(8, Math.floor(mean50)));
    const baseProb = (9 - barrier) / 10;
    const expectedWR = baseProb + Math.abs(diff) * 0.03; // small edge from reversion
    const confidence = Math.min(Math.abs(diff) / 2.5, 0.80);

    if (confidence < 0.30) return null;

    return {
      contractType: 'DIGITOVER',
      barrier,
      confidence,
      expectedWinRate: Math.min(expectedWR, 0.95),
      reason: `MeanRevOVER: recent_mean=${mean.toFixed(1)} < avg50=${mean50.toFixed(1)} barrier=d${barrier}`,
    };
  } else if (diff > 1.0) {
    // Recent digits are much higher → bet UNDER
    const barrier = Math.max(1, Math.min(9, Math.ceil(mean50)));
    const baseProb = (barrier + 1) / 10;
    const expectedWR = baseProb + Math.abs(diff) * 0.03;
    const confidence = Math.min(Math.abs(diff) / 2.5, 0.80);

    if (confidence < 0.30) return null;

    return {
      contractType: 'DIGITUNDER',
      barrier,
      confidence,
      expectedWinRate: Math.min(expectedWR, 0.95),
      reason: `MeanRevUNDER: recent_mean=${mean.toFixed(1)} > avg50=${mean50.toFixed(1)} barrier=d${barrier}`,
    };
  }

  return null;
}

// Strategy 8: Even/Odd Imbalance OVER/UNDER
// If recent digits are heavily even or odd, exploit it
export function strategyEvenOddOU(state: MarketState): TradeSignal | null {
  if (state.totalTicks < 20) return null;

  const recent = state.digitHistory.slice(-20);
  const evenCount = recent.filter(d => d % 2 === 0).length;
  const evenPct = evenCount / recent.length;

  // If heavily even (75%+), digits are likely 0,2,4,6,8 → UNDER d5 or OVER d4
  if (evenPct >= 0.75) {
    // Most digits are even (0,2,4,6,8). Mean is ~4.
    // UNDER d6 = digits 0-5 = 60% base, but with even bias more like 55-60% of the evens are 0,2,4
    return {
      contractType: 'DIGITUNDER',
      barrier: 5,
      confidence: Math.min((evenPct - 0.60) / 0.30, 0.75),
      expectedWinRate: 0.60,
      reason: `E/O UNDER: ${(evenPct*100).toFixed(0)}% even in 20`,
    };
  } else if (evenPct <= 0.25) {
    // Heavily odd (1,3,5,7,9). Mean is ~5.
    return {
      contractType: 'DIGITOVER',
      barrier: 4,
      confidence: Math.min((0.40 - evenPct) / 0.30, 0.75),
      expectedWinRate: 0.60,
      reason: `E/O OVER: ${(100-evenPct*100).toFixed(0)}% odd in 20`,
    };
  }

  return null;
}

// Strategy 9: Range Contraction/Dilation
// If recent digits are tightly clustered (low std dev), bet they'll expand
export function strategyRangeExpansionOU(state: MarketState): TradeSignal | null {
  if (state.totalTicks < 30) return null;

  const recent20 = state.digitHistory.slice(-20);
  const mean = recent20.reduce((a, b) => a + b, 0) / 20;
  const variance = recent20.reduce((sum, d) => sum + (d - mean) ** 2, 0) / 20;
  const stdDev = Math.sqrt(variance);

  // Expected std dev for uniform 0-9 = ~2.87
  // If std dev < 2.0, digits are too clustered — likely to expand
  if (stdDev < 2.0) {
    // Digits clustered low → OVER
    if (mean < 4.5) {
      return {
        contractType: 'DIGITOVER',
        barrier: Math.max(0, Math.round(mean + stdDev)),
        confidence: Math.min((2.87 - stdDev) / 1.5, 0.80),
        expectedWinRate: 0.65,
        reason: `RangeExpOVER: std=${stdDev.toFixed(1)} mean=${mean.toFixed(1)}`,
      };
    } else {
      return {
        contractType: 'DIGITUNDER',
        barrier: Math.min(9, Math.round(mean - stdDev)),
        confidence: Math.min((2.87 - stdDev) / 1.5, 0.80),
        expectedWinRate: 0.65,
        reason: `RangeExpUNDER: std=${stdDev.toFixed(1)} mean=${mean.toFixed(1)}`,
      };
    }
  }

  return null;
}


// === STRATEGY RUNNER v4 ===
// Runs all strategies, applies per-market filters, returns best signal

const DIFF_STRATEGIES = [
  strategyRollingHotDiff,
  strategyStreakDiff,
  strategyTransitionDiff,
  strategyClusterDiff,
];

const MATCH_STRATEGIES = [
  strategyTripleRepeatMatch,
  strategyDominantTransitionMatch,
];

const OU_STRATEGIES = [
  strategyMeanReversionOU,
  strategyEvenOddOU,
  strategyRangeExpansionOU,
];

export function runAllStrategies(state: MarketState): TradeSignal | null {
  // v4: Per-market adaptive sit-out
  const marketWR = getMarketWR(state);
  const consecutiveLosses = getMarketConsecutiveLosses(state);

  // If this market has 3+ consecutive losses, sit out
  if (consecutiveLosses >= 3) return null;

  // If this market's rolling WR is below 35% with 10+ trades, sit out
  if (state.tradeResults.length >= 10 && marketWR < 0.35) return null;

  // Collect signals from all strategy groups
  const diffSignals: TradeSignal[] = [];
  const matchSignals: TradeSignal[] = [];
  const ouSignals: TradeSignal[] = [];

  for (const strategy of DIFF_STRATEGIES) {
    const signal = strategy(state);
    if (signal) diffSignals.push(signal);
  }
  for (const strategy of MATCH_STRATEGIES) {
    const signal = strategy(state);
    if (signal) matchSignals.push(signal);
  }
  for (const strategy of OU_STRATEGIES) {
    const signal = strategy(state);
    if (signal) ouSignals.push(signal);
  }

  // Priority: DIFF > OU > MATCH (safest first)
  // DIFF has ~90% base WR, OU has ~50-70%, MATCH has ~10%

  // --- DIFF signals ---
  if (diffSignals.length > 0) {
    // Find consensus: which digit do most strategies agree on?
    const barrierVotes = new Map<number, { signals: TradeSignal[]; totalConf: number }>();
    for (const s of diffSignals) {
      if (s.barrier === undefined) continue;
      const existing = barrierVotes.get(s.barrier);
      if (existing) {
        existing.signals.push(s);
        existing.totalConf += s.confidence;
      } else {
        barrierVotes.set(s.barrier, { signals: [s], totalConf: s.confidence });
      }
    }

    // Pick barrier with most votes + highest confidence
    let bestBarrier = 0, bestScore = -1, bestInfo = barrierVotes.values().next().value;
    for (const [barrier, info] of barrierVotes) {
      const consensusBonus = info.signals.length >= 3 ? 0.3 : info.signals.length >= 2 ? 0.15 : 0;
      const score = info.totalConf * (1 + consensusBonus);
      if (score > bestScore) {
        bestScore = score;
        bestBarrier = barrier;
        bestInfo = info;
      }
    }

    // v6: Lowered threshold — 0.25 for DIFF (was 0.40, too restrictive)
    if (bestScore < 0.25) return null;

    const avgExpectedWR = bestInfo.signals.reduce((s, sig) => s + sig.expectedWinRate, 0) / bestInfo.signals.length;
    const consensusTag = bestInfo.signals.length >= 2 ? `[${bestInfo.signals.length}x] ` : '';

    return {
      contractType: 'DIGITDIFF',
      barrier: bestBarrier,
      confidence: Math.min(bestScore, 0.98),
      expectedWinRate: avgExpectedWR,
      reason: `${consensusTag}DIFF d${bestBarrier} | ${bestInfo.signals[0].reason}`,
    };
  }

  // --- OVER/UNDER signals ---
  if (ouSignals.length > 0) {
    // Pick highest confidence O/U signal
    ouSignals.sort((a, b) => b.confidence - a.confidence);
    const best = ouSignals[0];

    // v6: Lowered to 0.30 for O/U (was 0.45, too restrictive)
    if (best.confidence < 0.30) return null;

    return best;
  }

  // --- MATCH signals (highest risk, lowest priority) ---
  if (matchSignals.length > 0) {
    matchSignals.sort((a, b) => b.confidence - a.confidence);
    const best = matchSignals[0];

    // v6: Lowered to 0.35 for MATCH (was 0.50, too restrictive)
    if (best.confidence < 0.35) return null;

    return best;
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
      // Bonus for DIFF (safest)
      if (signal.contractType === 'DIGITDIFF') score += 15;
      else if (signal.contractType.startsWith('DIGITOVER') || signal.contractType.startsWith('DIGITUNDER')) score += 5;
      // Bonus for expected WR
      score += signal.expectedWinRate * 20;
      if (state.totalTicks > 100) score += 5;
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

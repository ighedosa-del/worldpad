'use client';

// === Robustness Engine — Ported from LUCAS robustness.mjs ===
// Walk-forward validation + Monte Carlo simulation + Lifecycle stages
// Lets the bot graduate from "always trade" to "trade with verified statistical edge"

import { wilsonLower } from './lucas-math';

export interface SettledRow {
  id: string;
  key: string;
  symbol: string;
  strategy: string;
  direction: string;
  duration: number;
  regime: string;
  volatilityState: string;
  entry: number;
  exit?: number;
  score: number;
  source: 'LIVE' | 'HISTORY' | 'BACKTEST';
  win: boolean;
  createdAt: number;
  settledAt?: number;
}

// === WALK-FORWARD VALIDATION ===
// Split data 70/30 by time. Train on first 70%, test on last 30%.
// If test WR >= 50% AND Wilson LB of test >= 40%, the strategy passes.

export interface WalkForwardResult {
  ready: boolean;
  n: number;
  reason?: string;
  trainN?: number;
  testN?: number;
  trainRate?: number;
  testRate?: number;
  trainWilson?: number;
  testWilson?: number;
  pass: boolean;
}

export function walkForward(
  rows: SettledRow[],
  options: { minTrain?: number; minTest?: number } = {}
): WalkForwardResult {
  const { minTrain = 40, minTest = 20 } = options;

  if (rows.length < minTrain + minTest) {
    return { ready: false, n: rows.length, reason: 'INSUFFICIENT_WALK_FORWARD_DATA', pass: false };
  }

  // Sort by settled time (chronological)
  const ordered = [...rows].sort((a, b) => (a.settledAt || 0) - (b.settledAt || 0));
  const split = Math.floor(ordered.length * 0.7);
  const train = ordered.slice(0, split);
  const test = ordered.slice(split);

  const tw = train.filter(x => x.win).length;
  const vw = test.filter(x => x.win).length;
   const trainRate = tw / train.length;
  const testRate = vw / test.length;

  return {
    ready: true,
    trainN: train.length,
    testN: test.length,
    trainRate,
    testRate,
    trainWilson: wilsonLower(tw, train.length),
    testWilson: wilsonLower(vw, test.length),
    pass: test.length >= minTest && testRate >= 0.5 && wilsonLower(vw, test.length) >= 0.40,
  };
}

// === MONTE CARLO SIMULATION ===
// 10,000 resampling runs with 2% adverse flip rate.
// If 80%+ of simulations survive with max drawdown <= 18, the strategy passes.

export interface MonteCarloResult {
  ready: boolean;
  n: number;
  reason?: string;
  runs: number;
  adverseFlipRate: number;
  survivalRate: number;
  averageMaxDrawdown: number;
  worstMaxDrawdown: number;
  pass: boolean;
}

function maxDrawdown(sequence: boolean[]): number {
  let equity = 0, peak = 0, dd = 0;
  for (const x of sequence) {
    equity += x ? 1 : -1;
    peak = Math.max(peak, equity);
    dd = Math.max(dd, peak - equity);
  }
  return dd;
}

export function monteCarlo(
  rows: SettledRow[],
  options: {
    runs?: number;
    maxDrawdownLimit?: number;
    minSurvival?: number;
    adverseFlipRate?: number;
  } = {}
): MonteCarloResult {
  const {
    runs = 10000,
    maxDrawdownLimit = 18,
    minSurvival = 0.8,
    adverseFlipRate = 0.02,
  } = options;

  if (rows.length < 40) {
    return { ready: false, n: rows.length, reason: 'INSUFFICIENT_MONTE_CARLO_DATA', runs, adverseFlipRate, survivalRate: 0, averageMaxDrawdown: 0, worstMaxDrawdown: 0, pass: false };
  }

  const outcomes = rows.slice(-250).map(x => !!x.win);
  const n = outcomes.length;
  let survivors = 0;
  let worst = 0;
  let totalDd = 0;

  for (let r = 0; r < runs; r++) {
    const sample: boolean[] = [];
    for (let i = 0; i < n; i++) {
      let outcome = outcomes[Math.floor(Math.random() * n)];
      // Adverse flip: randomly turn some wins into losses
      if (outcome && Math.random() < adverseFlipRate) outcome = false;
      sample.push(outcome);
    }
    const dd = maxDrawdown(sample);
    worst = Math.max(worst, dd);
    totalDd += dd;
    if (dd <= maxDrawdownLimit) survivors++;
  }

  const survivalRate = survivors / runs;

  return {
    ready: true,
    runs,
    adverseFlipRate,
    survivalRate,
    averageMaxDrawdown: totalDd / runs,
    worstMaxDrawdown: worst,
    pass: survivalRate >= minSurvival,
  };
}

// === LIFECYCLE STAGES ===
// RESEARCH → VALIDATING → ROBUST → VERIFIED → QUARANTINED → DEGRADING
// A strategy must pass walk-forward + Monte Carlo to reach ROBUST.
// At 100+ samples it reaches VERIFIED.

export type LifecycleStage = 'RESEARCH' | 'VALIDATING' | 'ROBUST' | 'VERIFIED' | 'QUARANTINED' | 'DEGRADING';

export interface LifecycleResult {
  stats: { n: number; wins: number; winRate: number; recentN: number; recentWinRate: number };
  walk: WalkForwardResult;
  mc: MonteCarloResult;
  stage: LifecycleStage;
}

export function lifecycle(
  stats: { n: number; wins: number; winRate: number; recentN?: number; recentWinRate?: number; recentWins?: number },
  walk: WalkForwardResult,
  mc: MonteCarloResult,
): LifecycleResult {
  const recentN = stats.recentN ?? 0;
  const recentWinRate = stats.recentWinRate ?? (stats.n > 0 ? stats.winRate : 0.5);

  // Check for degradation
  const degrading = recentN >= 30 && recentWinRate + 0.07 < stats.winRate;
  if (degrading) {
    return { stats: stats as LifecycleResult['stats'], walk, mc, stage: 'DEGRADING' };
  }

  if (stats.n < 40) {
    return { stats: stats as LifecycleResult['stats'], walk, mc, stage: 'RESEARCH' };
  }
  if (stats.n < 60) {
    return { stats: stats as LifecycleResult['stats'], walk, mc, stage: 'VALIDATING' };
  }

  if (!walk.ready || !mc.ready) {
    return { stats: stats as LifecycleResult['stats'], walk, mc, stage: 'VALIDATING' };
  }
  if (!walk.pass || !mc.pass) {
    return { stats: stats as LifecycleResult['stats'], walk, mc, stage: 'QUARANTINED' };
  }
  if (wilsonLower(stats.wins, stats.n) < 0.5) {
    return { stats: stats as LifecycleResult['stats'], walk, mc, stage: 'QUARANTINED' };
  }

  if (stats.n < 100) {
    return { stats: stats as LifecycleResult['stats'], walk, mc, stage: 'ROBUST' };
  }

  return { stats: stats as LifecycleResult['stats'], walk, mc, stage: 'VERIFIED' };
}

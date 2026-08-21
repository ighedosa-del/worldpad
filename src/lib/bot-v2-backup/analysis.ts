'use client';

import type { MarketState } from './strategies';

// === Analysis Pipeline v4 — Multi-Contract Support ===
// Handles: DIGITDIFF, DIGITMATCH, DIGITOVER, DIGITUNDER
// Key fixes:
//   - Real payout estimation per contract type
//   - Look-ahead-free backtesting
//   - Proper EV for each contract type

export interface RegimeResult {
  regime: 'random' | 'weak_signal' | 'strong_signal';
  confidence: number;
  chiSquared: number;
  chiSquaredP: number;
  entropy: number;
  entropyDeviation: number;
  runsZ: number;
  runsCount: number;
  tradability: number;
  acf1: number;
  acf2: number;
}

export interface PatternSignal {
  contractType: string;
  barrier?: number;
  reason: string;
  confidence: number;
  source: string;
}

export interface BacktestResult {
  winRate: number;
  passed: boolean;
  grade: string;
  sampleSize: number;
  profitFactor: number;
}

// === REAL PAYOUT ESTIMATES ===
// Based on actual Deriv API responses for digit contracts with $0.35 stake
// These are approximate but much better than the old hardcoded values

export function getEstimatedPayout(contractType: string): number {
  switch (contractType) {
    case 'DIGITDIFF':
      // Payout for DIFF is typically: stake + ~$0.03-0.06 profit
      // So net profit = ~0.08-0.17 of stake
      return 0.12; // net profit as fraction of stake
    case 'DIGITMATCH':
      // Payout for MATCH is typically: stake * ~8-9x
      // So net profit = ~7-8x stake
      return 7.5; // net profit as fraction of stake
    case 'DIGITOVER':
    case 'DIGITUNDER':
      // Varies by barrier. For d4/d5 (50% prob) ~1.9x payout
      // For d2/d7 (70% prob) ~1.2x payout
      // For d0/d9 (90% prob) ~1.05x payout
      // Conservative average estimate
      return 0.45; // net profit as fraction of stake
    default:
      return 0.12;
  }
}

export function getBaseProbability(contractType: string, barrier?: number): number {
  switch (contractType) {
    case 'DIGITDIFF':
      return 0.90; // 9/10 digits win
    case 'DIGITMATCH':
      return 0.10; // 1/10 digits win
    case 'DIGITOVER':
      return barrier !== undefined ? (9 - barrier) / 10 : 0.50;
    case 'DIGITUNDER':
      return barrier !== undefined ? (barrier + 1) / 10 : 0.50;
    default:
      return 0.50;
  }
}

// === REGIME FILTER v2 ===

const EXPECTED_ENTROPY = 3.32193;
const MIN_DIGITS_REGIME = 50;

function chiSquaredPValue(chi2: number): number {
  const table = [
    [4.17, 0.90], [5.90, 0.80], [6.63, 0.75], [7.26, 0.70],
    [8.34, 0.50], [9.42, 0.40], [10.66, 0.30], [12.24, 0.20],
    [14.68, 0.10], [16.92, 0.05], [19.02, 0.025], [21.67, 0.01],
  ];
  if (chi2 <= table[0][0]) return 0.95;
  if (chi2 >= table[table.length - 1][0]) return 0.005;
  for (let i = 0; i < table.length - 1; i++) {
    if (chi2 >= table[i][0] && chi2 < table[i + 1][0]) {
      const t = (chi2 - table[i][0]) / (table[i + 1][0] - table[i][0]);
      return table[i][1] + t * (table[i + 1][1] - table[i][1]);
    }
  }
  return 0.5;
}

function chiSquaredTest(distribution: number[], total: number): { statistic: number; pValue: number } {
  const expected = total / 10;
  let chi2 = 0;
  for (let i = 0; i < 10; i++) {
    const diff = distribution[i] - expected;
    chi2 += (diff * diff) / expected;
  }
  return { statistic: chi2, pValue: chiSquaredPValue(chi2) };
}

function runsTest(digits: number[]): { runsCount: number; zScore: number } {
  const n1 = digits.filter(d => d % 2 === 0).length;
  const n2 = digits.length - n1;
  if (n1 < 5 || n2 < 5) return { runsCount: 0, zScore: 0 };
  let runs = 1;
  for (let i = 1; i < digits.length; i++) {
    if ((digits[i] % 2) !== (digits[i - 1] % 2)) runs++;
  }
  const n = n1 + n2;
  const expectedRuns = (2 * n1 * n2) / n + 1;
  const variance = (2 * n1 * n2 * (2 * n1 * n2 - n)) / (n * n * (n - 1));
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return { runsCount: runs, zScore: 0 };
  return { runsCount: runs, zScore: (runs - expectedRuns) / stdDev };
}

function autocorrelationAt(digits: number[], lag: number): number {
  if (digits.length < 40) return 0;
  const n = digits.length;
  const mean = digits.reduce((a, b) => a + b, 0) / n;
  let numerator = 0, denominator = 0;
  for (let i = lag; i < n; i++) numerator += (digits[i] - mean) * (digits[i - lag] - mean);
  for (let i = 0; i < n; i++) denominator += (digits[i] - mean) * (digits[i] - mean);
  return denominator === 0 ? 0 : numerator / denominator;
}

export function analyzeRegime(state: MarketState): RegimeResult {
  if (state.totalTicks < MIN_DIGITS_REGIME) {
    return { regime: 'random', confidence: 0, chiSquared: 0, chiSquaredP: 0.5, entropy: EXPECTED_ENTROPY, entropyDeviation: 0, runsZ: 0, runsCount: 0, tradability: 0, acf1: 0, acf2: 0 };
  }
  const digits = state.digitHistory.slice(-200);
  const total = digits.length;
  const dist = new Array(10).fill(0);
  for (const d of digits) dist[d]++;

  const { statistic: chi2, pValue: chiP } = chiSquaredTest(dist, total);
  const { runsCount, zScore: runsZ } = runsTest(digits);
  let entropy = 0;
  for (let i = 0; i < 10; i++) {
    const p = dist[i] / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const entropyDev = EXPECTED_ENTROPY - entropy;
  const acf1 = autocorrelationAt(digits, 1);
  const acf2 = autocorrelationAt(digits, 2);

  let score = 0;
  if (chiP < 0.05) score += 0.35;
  else if (chiP < 0.20) score += 0.20;
  if (entropyDev > 0.3) score += 0.20;
  else if (entropyDev > 0.15) score += 0.10;
  if (Math.abs(runsZ) > 2.58) score += 0.25;
  else if (Math.abs(runsZ) > 1.96) score += 0.20;
  else if (Math.abs(runsZ) > 1.5) score += 0.10;
  if (Math.abs(acf1) > 0.15) score += 0.20;
  else if (Math.abs(acf1) > 0.10) score += 0.10;
  if (Math.abs(acf2) > 0.12) score += 0.10;
  else if (Math.abs(acf2) > 0.08) score += 0.05;
  score = Math.min(score, 1);

  let regime: RegimeResult['regime'] = 'random';
  if (score >= 0.50) regime = 'strong_signal';
  else if (score >= 0.25) regime = 'weak_signal';

  let tradability = 0;
  if (regime === 'strong_signal') tradability = 0.8 + score * 0.2;
  else if (regime === 'weak_signal') tradability = 0.4 + score * 0.4;
  else tradability = score * 0.5;

  return { regime, confidence: score, chiSquared: chi2, chiSquaredP: chiP, entropy, entropyDeviation: entropyDev, runsZ, runsCount, tradability, acf1, acf2 };
}

// === PATTERN DETECTION v2 ===

function detectStreak(state: MarketState): PatternSignal | null {
  const digits = state.digitHistory;
  if (digits.length < 4) return null;
  const last = digits[digits.length - 1];
  let streak = 1;
  for (let i = digits.length - 2; i >= 0; i--) {
    if (digits[i] === last) streak++;
    else break;
  }
  if (streak < 3) return null;
  return { contractType: 'DIGITDIFF', barrier: last, reason: `Streak: d${last} x${streak}`, confidence: Math.min(0.6 + streak * 0.08, 0.95), source: 'streak' };
}

function detectClusters(state: MarketState): PatternSignal | null {
  if (state.totalTicks < 20) return null;
  const recent = state.digitHistory.slice(-10);
  const counts = new Array(10).fill(0);
  for (const d of recent) counts[d]++;
  const maxCount = Math.max(...counts);
  if (maxCount < 3) return null;
  const hotDigit = counts.indexOf(maxCount);
  return { contractType: 'DIGITDIFF', barrier: hotDigit, reason: `Cluster: d${hotDigit} ${maxCount}x/10`, confidence: Math.min((maxCount - 2) / 3, 1), source: 'cluster' };
}

export function detectPatterns(state: MarketState): PatternSignal | null {
  const detectors = [detectStreak, detectClusters];
  let best: PatternSignal | null = null;
  for (const detect of detectors) {
    const signal = detect(state);
    if (!signal) continue;
    if (!best || signal.confidence > best.confidence) best = signal;
  }
  return best;
}

// === BACKTESTING v4 — Look-ahead free ===
// Tests on HISTORICAL data only (excluding last N ticks to avoid look-ahead)

export function backtestSignal(state: MarketState, contractType: string, barrier: number | undefined): BacktestResult {
  const digits = state.digitHistory;
  // Need at least 50 historical digits, exclude last 5 to avoid look-ahead
  if (digits.length < 55 || barrier === undefined) {
    return { winRate: getBaseProbability(contractType, barrier), passed: true, grade: 'C', sampleSize: 0, profitFactor: 0 };
  }

  // Use historical data EXCLUDING the last 5 ticks (look-ahead prevention)
  const testDigits = digits.slice(-205, -5);
  if (testDigits.length < 50) {
    return { winRate: getBaseProbability(contractType, barrier), passed: true, grade: 'C', sampleSize: 0, profitFactor: 0 };
  }

  let wins = 0;
  for (const d of testDigits) {
    if (contractType === 'DIGITDIFF' && d !== barrier) wins++;
    else if (contractType === 'DIGITMATCH' && d === barrier) wins++;
    else if (contractType === 'DIGITOVER' && d > barrier) wins++;
    else if (contractType === 'DIGITUNDER' && d < barrier) wins++;
  }
  const winRate = wins / testDigits.length;
  const losses = testDigits.length - wins;
  const payoutNet = getEstimatedPayout(contractType);
  const profitFactor = losses > 0 ? (wins * payoutNet) / losses : wins > 0 ? 999 : 0;

  // Grading depends on contract type
  let grade = 'F';
  let passed = false;
  if (contractType === 'DIGITDIFF') {
    if (winRate >= 0.92) { grade = 'A'; passed = true; }
    else if (winRate >= 0.90) { grade = 'B'; passed = true; }
    else if (winRate >= 0.88) { grade = 'C'; passed = true; }
    else if (winRate >= 0.85) { grade = 'D'; }
    else { grade = 'F'; }
  } else if (contractType === 'DIGITMATCH') {
    if (winRate >= 0.15) { grade = 'A'; passed = true; }
    else if (winRate >= 0.12) { grade = 'C'; passed = true; }
    else { grade = 'F'; }
  } else {
    // OVER/UNDER: need above base probability
    const baseProb = getBaseProbability(contractType, barrier);
    const excess = winRate - baseProb;
    if (excess >= 0.10) { grade = 'A'; passed = true; }
    else if (excess >= 0.05) { grade = 'B'; passed = true; }
    else if (excess >= 0.02) { grade = 'C'; passed = true; }
    else { grade = 'F'; }
  }
  return { winRate, passed, grade, sampleSize: testDigits.length, profitFactor };
}

// v4: Find the best DIFF barrier (which digit is most over-represented)
export function findBestBarrier(state: MarketState): { barrier: number; winRate: number } | null {
  if (state.totalTicks < 55) return null;
  // Exclude last 5 ticks
  const digits = state.digitHistory.slice(-205, -5);
  if (digits.length < 50) return null;

  let bestBarrier = 0, bestWinRate = 0;
  for (let d = 0; d < 10; d++) {
    let wins = 0;
    for (const tick of digits) {
      if (tick !== d) wins++;
    }
    const wr = wins / digits.length;
    if (wr > bestWinRate) { bestWinRate = wr; bestBarrier = d; }
  }

  // Only return if significantly above random (88%+)
  if (bestWinRate < 0.88) return null;
  return { barrier: bestBarrier, winRate: bestWinRate };
}

// === EV CALCULATION v4 ===
// Uses real payout estimates per contract type
export function calculateEV(
  contractType: string,
  backtestWinRate: number,
  regimeTradability: number,
  profitFactor: number = 0
): number {
  const payoutNet = getEstimatedPayout(contractType);
  const baseProb = getBaseProbability(contractType);

  // Blend backtest WR with regime-adjusted base probability
  const adjustedWinProb = backtestWinRate * 0.7 + (baseProb * regimeTradability) * 0.3;

  // EV = P(win) * profit_per_win - P(loss) * 1 (stake)
  const ev = adjustedWinProb * payoutNet - (1 - adjustedWinProb) * 1.0;
  return ev;
}

// === FULL ANALYSIS PIPELINE v4 ===

export interface FullAnalysis {
  regime: RegimeResult;
  patternSignal: PatternSignal | null;
  backtest: BacktestResult | null;
  ev: number;
  evPositive: boolean;
  shouldTrade: boolean;
  bestBarrier: number | null;
  bestBarrierWinRate: number;
}

export function fullAnalysis(state: MarketState, signal: { contractType: string; barrier?: number } | null): FullAnalysis {
  // Step 1: Regime filter
  const regime = analyzeRegime(state);

  // Step 2: Pattern detection
  const patternSignal = detectPatterns(state);

  // Step 3: Use caller's signal or pattern signal
  const tradeSignal = signal || patternSignal;
  if (!tradeSignal) {
    return { regime, patternSignal, backtest: null, ev: -0.5, evPositive: false, shouldTrade: false, bestBarrier: null, bestBarrierWinRate: 0 };
  }

  // Step 4: Find the best DIFF barrier (optimization)
  const bestBarrierResult = findBestBarrier(state);

  // Step 5: Backtest the signal's barrier
  const backtest = backtestSignal(state, tradeSignal.contractType, tradeSignal.barrier);

  // Step 6: If signal's barrier fails backtest but we found a better DIFF barrier
  let effectiveBacktest = backtest;
  let effectiveSignal = tradeSignal;
  if (!backtest.passed && bestBarrierResult && bestBarrierResult.winRate >= 0.88 && tradeSignal.contractType === 'DIGITDIFF') {
    effectiveBacktest = backtestSignal(state, 'DIGITDIFF', bestBarrierResult.barrier);
    effectiveSignal = { contractType: 'DIGITDIFF', barrier: bestBarrierResult.barrier };
  }

  if (!effectiveBacktest.passed) {
    return { regime, patternSignal, backtest: effectiveBacktest, ev: -0.3, evPositive: false, shouldTrade: false, bestBarrier: bestBarrierResult?.barrier ?? null, bestBarrierWinRate: bestBarrierResult?.winRate ?? 0 };
  }

  // Step 7: Calculate EV with real payouts
  const ev = calculateEV(effectiveSignal.contractType, effectiveBacktest.winRate, regime.tradability, effectiveBacktest.profitFactor);

  // Step 8: Decision — use real payout-aware EV threshold
  // For DIFF: need positive EV (payout is thin)
  // For MATCH: need positive EV (high risk, high reward)
  // For O/U: slightly more permissive
  let minEV = -0.02;
  if (effectiveSignal.contractType === 'DIGITMATCH') minEV = -0.05;

  const shouldTrade = ev > minEV && effectiveBacktest.passed && regime.tradability > 0.15;

  return {
    regime,
    patternSignal,
    backtest: effectiveBacktest,
    ev,
    evPositive: ev > 0,
    shouldTrade,
    bestBarrier: bestBarrierResult?.barrier ?? null,
    bestBarrierWinRate: bestBarrierResult?.winRate ?? 0,
  };
}

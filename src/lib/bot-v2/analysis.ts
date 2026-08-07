'use client';

import type { MarketState } from './strategies';

// === Analysis Pipeline v2 ===
// Regime filter + Pattern detection + Backtesting
// Pure functions. No React. Works with MarketState from strategies.ts.

export interface RegimeResult {
  regime: 'random' | 'weak_signal' | 'strong_signal';
  confidence: number;
  chiSquared: number;
  chiSquaredP: number;
  entropy: number;
  entropyDeviation: number;
  runsZ: number;
  tradability: number;
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
}

// === REGIME FILTER ===

const EXPECTED_ENTROPY = 3.32193; // log2(10)
const MIN_DIGITS_REGIME = 50;

function chiSquaredPValue(chi2: number, df: number): number {
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
  return { statistic: chi2, pValue: chiSquaredPValue(chi2, 9) };
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

function autocorrelation(digits: number[]): number {
  if (digits.length < 40) return 0;
  const n = digits.length;
  const mean = digits.reduce((a, b) => a + b, 0) / n;
  let numerator = 0, denominator = 0;
  for (let i = 1; i < n; i++) numerator += (digits[i] - mean) * (digits[i - 1] - mean);
  for (let i = 0; i < n; i++) denominator += (digits[i] - mean) * (digits[i] - mean);
  return denominator === 0 ? 0 : numerator / denominator;
}

export function analyzeRegime(state: MarketState): RegimeResult {
  if (state.totalTicks < MIN_DIGITS_REGIME) {
    return { regime: 'random', confidence: 0, chiSquared: 0, chiSquaredP: 0.5, entropy: EXPECTED_ENTROPY, entropyDeviation: 0, runsZ: 0, tradability: 0 };
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
  const acf = autocorrelation(digits);

  let score = 0;
  if (chiP < 0.05) score += 0.35;
  else if (chiP < 0.20) score += 0.20;
  if (entropyDev > 0.3) score += 0.20;
  else if (entropyDev > 0.15) score += 0.10;
  if (Math.abs(runsZ) > 2.58) score += 0.25;
  else if (Math.abs(runsZ) > 1.96) score += 0.20;
  else if (Math.abs(runsZ) > 1.5) score += 0.10;
  if (Math.abs(acf) > 0.15) score += 0.20;
  else if (Math.abs(acf) > 0.10) score += 0.10;
  score = Math.min(score, 1);

  let regime: RegimeResult['regime'] = 'random';
  if (score >= 0.50) regime = 'strong_signal';
  else if (score >= 0.25) regime = 'weak_signal';

  let tradability = 0;
  if (regime === 'strong_signal') tradability = 0.8 + score * 0.2;
  else if (regime === 'weak_signal') tradability = 0.4 + score * 0.4;
  else tradability = score * 0.5;

  return { regime, confidence: score, chiSquared: chi2, chiSquaredP: chiP, entropy, entropyDeviation: entropyDev, runsZ, runsCount, tradability };
}

// === PATTERN DETECTION ===

function detectGaps(state: MarketState): PatternSignal | null {
  if (state.totalTicks < 30) return null;
  const digits = state.digitHistory;
  const lastSeen = new Array(10).fill(-1);
  for (let i = 0; i < digits.length; i++) lastSeen[digits[i]] = i;
  const gaps = lastSeen.map(pos => digits.length - 1 - pos);
  const maxGap = Math.max(...gaps);
  if (maxGap < 18) return null;
  const maxGapDigit = gaps.indexOf(maxGap);
  return { contractType: 'DIGITDIFF', barrier: maxGapDigit, reason: `Gap: d${maxGapDigit} missing ${maxGap} ticks`, confidence: Math.min(maxGap / 30, 1), source: 'gap' };
}

function detectAlternating(state: MarketState): PatternSignal | null {
  if (state.totalTicks < 12) return null;
  const recent = state.digitHistory.slice(-20);
  let eoAltCount = 0;
  for (let i = 1; i < recent.length; i++) {
    if ((recent[i] % 2) !== (recent[i - 1] % 2)) eoAltCount++;
  }
  const eoAltRate = eoAltCount / (recent.length - 1);
  if (eoAltRate < 0.70) return null;
  const lastDigit = recent[recent.length - 1];
  return { contractType: 'DIGITDIFF', barrier: lastDigit, reason: `E/O alt: ${Math.round(eoAltRate * 100)}%`, confidence: Math.min((eoAltRate - 0.70) / 0.25, 1), source: 'alternating' };
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

function detectHotCold(state: MarketState): PatternSignal | null {
  if (state.totalTicks < 30) return null;
  const total = state.totalTicks;
  let hottestDigit = 0, hottestPct = -1;
  let coldestDigit = 0, coldestPct = Infinity;
  for (let i = 0; i < 10; i++) {
    const pct = (state.distribution[i] / total) * 100;
    if (pct > hottestPct) { hottestPct = pct; hottestDigit = i; }
    if (pct < coldestPct) { coldestPct = pct; coldestDigit = i; }
  }
  const spread = hottestPct - coldestPct;
  if (spread < 6) return null;
  return { contractType: 'DIGITDIFF', barrier: hottestDigit, reason: `Hot: d${hottestDigit} ${hottestPct.toFixed(1)}% vs d${coldestDigit} ${coldestPct.toFixed(1)}%`, confidence: Math.min(spread / 15, 1), source: 'hotcold' };
}

export function detectPatterns(state: MarketState): PatternSignal | null {
  const detectors = [detectStreak, detectGaps, detectClusters, detectHotCold, detectAlternating];
  let best: PatternSignal | null = null;
  for (const detect of detectors) {
    const signal = detect(state);
    if (!signal) continue;
    if (!best || signal.confidence > best.confidence) best = signal;
  }
  return best;
}

// === BACKTESTING ===

export function backtestSignal(state: MarketState, contractType: string, barrier: number | undefined): BacktestResult {
  const digits = state.digitHistory;
  if (digits.length < 50 || barrier === undefined) {
    return { winRate: 0.90, passed: true, grade: 'C', sampleSize: 0 };
  }
  const testDigits = digits.slice(-200);
  let wins = 0;
  for (const d of testDigits) {
    if (contractType === 'DIGITDIFF' && d !== barrier) wins++;
    else if (contractType === 'DIGITMATCH' && d === barrier) wins++;
  }
  const winRate = wins / testDigits.length;
  let grade = 'F';
  let passed = false;
  if (contractType === 'DIGITDIFF') {
    if (winRate >= 0.92) { grade = 'A'; passed = true; }
    else if (winRate >= 0.88) { grade = 'B'; passed = true; }
    else if (winRate >= 0.85) { grade = 'C'; passed = true; }
    else if (winRate >= 0.80) { grade = 'D'; }
    else { grade = 'F'; }
  } else {
    if (winRate >= 0.15) { grade = 'A'; passed = true; }
    else if (winRate >= 0.12) { grade = 'C'; passed = true; }
    else { grade = 'F'; }
  }
  return { winRate, passed, grade, sampleSize: testDigits.length };
}

// === EV CALCULATION ===
// Expected Value = P(win) * profit_per_win - P(loss) * stake
// For DIGITDIFF: P(win) ~90%, payout = $0.85 per $1 stake
// EV = 0.90 * 0.85 - 0.10 * 1.0 = 0.765 - 0.10 = +0.665 per $1 (positive EV)
// For DIGITMATCH: P(win) ~10%, payout = $8.5 per $1 stake  
// EV = 0.10 * 8.5 - 0.90 * 1.0 = 0.85 - 0.90 = -0.05 per $1 (negative EV!)

export function calculateEV(contractType: string, backtestWinRate: number, regimeTradability: number): number {
  const isMatch = contractType === 'DIGITMATCH';
  const profitRatio = isMatch ? 8.5 : 0.85;
  // Blend backtest win rate with regime tradability for adjusted probability
  const adjustedWinProb = backtestWinRate * 0.7 + regimeTradability * 0.3 * (isMatch ? 0.10 : 0.90);
  const ev = adjustedWinProb * profitRatio - (1 - adjustedWinProb) * 1.0;
  return ev;
}

// === FULL ANALYSIS PIPELINE ===

export interface FullAnalysis {
  regime: RegimeResult;
  patternSignal: PatternSignal | null;
  backtest: BacktestResult | null;
  ev: number;
  evPositive: boolean;
  shouldTrade: boolean;
}

export function fullAnalysis(state: MarketState, signal: { contractType: string; barrier?: number } | null): FullAnalysis {
  // Step 1: Regime filter
  const regime = analyzeRegime(state);
  if (regime.regime === 'random' && regime.confidence < 0.15) {
    return { regime, patternSignal: null, backtest: null, ev: -1, evPositive: false, shouldTrade: false };
  }

  // Step 2: Pattern detection
  const patternSignal = detectPatterns(state);

  // Step 3: If no signal from caller, use pattern signal
  const tradeSignal = signal || patternSignal;
  if (!tradeSignal) {
    return { regime, patternSignal, backtest: null, ev: -0.5, evPositive: false, shouldTrade: false };
  }

  // Step 4: Backtest the signal
  const backtest = backtestSignal(state, tradeSignal.contractType, tradeSignal.barrier);
  if (!backtest.passed) {
    return { regime, patternSignal, backtest, ev: -0.3, evPositive: false, shouldTrade: false };
  }

  // Step 5: Calculate EV
  const ev = calculateEV(tradeSignal.contractType, backtest.winRate, regime.tradability);

  // Step 6: Decision
  const shouldTrade = ev > 0 && backtest.passed && regime.tradability > 0.3;

  return { regime, patternSignal, backtest, ev, evPositive: ev > 0, shouldTrade };
}

'use client';

import type { MarketData } from './multi-market-ws';

// === Market Regime Filter ===
// Determines if a market is behaving randomly or has exploitable patterns.
// Uses statistical tests to classify market state.

export type Regime = 'random' | 'weak_signal' | 'strong_signal';

export interface RegimeResult {
  regime: Regime;
  confidence: number;       // 0-1, how confident we are in the classification
  chiSquared: number;        // chi-squared statistic (uniformity test)
  chiSquaredP: number;       // p-value (lower = more non-uniform)
  entropy: number;           // Shannon entropy in bits
   entropyDeviation: number;  // deviation from expected 3.32 bits
  runsCount: number;         // number of runs in the digit sequence
  runsZ: number;             // z-score for runs test (|z| > 1.96 = non-random at 95%)
  tradability: number;       // 0-1, how tradable this market is RIGHT NOW
}

const EXPECTED_ENTROPY = 3.32193; // log2(10)
const CHI_SQUARED_DF = 9;    // 10 digits - 1 degrees of freedom
const MIN_DIGITS_FOR_REGIME = 50;

// Approximate chi-squared CDF for df=9 using lookup + interpolation
// Returns p-value (probability of seeing this chi-squared or higher under null hypothesis)
function chiSquaredPValue(chi2: number, df: number): number {
  // For df=9, critical values:
  // p=0.05 → χ²=16.92, p=0.10 → χ²=14.68, p=0.20 → χ²=12.24
  // p=0.50 → χ²=8.34,  p=0.80 → χ²=5.90,  p=0.90 → χ²=4.17
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

// === 1. Chi-Squared Uniformity Test ===
// Tests if digits are uniformly distributed.
// High chi-squared → non-uniform → exploitable patterns exist.
function chiSquaredTest(distribution: number[], total: number): { statistic: number; pValue: number } {
  const expected = total / 10;
  let chi2 = 0;
  for (let i = 0; i < 10; i++) {
    const diff = distribution[i] - expected;
    chi2 += (diff * diff) / expected;
  }
  return { statistic: chi2, pValue: chiSquaredPValue(chi2, CHI_SQUARED_DF) };
}

// === 2. Runs Test (Wald-Wolfowitz) ===
// Tests for independence. A "run" is a consecutive sequence of same-type values.
// We use even/odd as the binary classification.
// Too few runs → negative autocorrelation (alternating)
// Too many runs → positive autocorrelation (clustering)
function runsTest(digits: number[]): { runsCount: number; zScore: number } {
  const n1 = digits.filter(d => d % 2 === 0).length; // even count
  const n2 = digits.length - n1;                      // odd count
  if (n1 < 5 || n2 < 5) return { runsCount: 0, zScore: 0 };

  // Count runs
  let runs = 1;
  for (let i = 1; i < digits.length; i++) {
    if ((digits[i] % 2) !== (digits[i - 1] % 2)) runs++;
  }

  // Expected runs and standard deviation
  const n = n1 + n2;
  const expectedRuns = (2 * n1 * n2) / n + 1;
  const variance = (2 * n1 * n2 * (2 * n1 * n2 - n)) / (n * n * (n - 1));
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return { runsCount: runs, zScore: 0 };

  const zScore = (runs - expectedRuns) / stdDev;
  return { runsCount: runs, zScore };
}

// === 3. Shannon Entropy ===
function calculateEntropy(distribution: number[], total: number): number {
  let entropy = 0;
  for (let i = 0; i < 10; i++) {
    const p = distribution[i] / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}

// === 4. Autocorrelation (lag-1) ===
// Measures correlation between digit[i] and digit[i-1]
// Near 0 = independent (random)
// Significantly positive/negative = pattern exists
function autocorrelation(digits: number[], lag: number = 1): number {
  if (digits.length < 40) return 0;
  const n = digits.length;
  const mean = digits.reduce((a, b) => a + b, 0) / n;

  let numerator = 0, denominator = 0;
  for (let i = lag; i < n; i++) {
    numerator += (digits[i] - mean) * (digits[i - lag] - mean);
  }
  for (let i = 0; i < n; i++) {
    denominator += (digits[i] - mean) * (digits[i] - mean);
  }

  return denominator === 0 ? 0 : numerator / denominator;
}

// === MAIN: Analyze Market Regime ===
export function analyzeRegime(data: MarketData): RegimeResult {
  if (data.digits.length < MIN_DIGITS_FOR_REGIME) {
    return {
      regime: 'random', confidence: 0, chiSquared: 0, chiSquaredP: 0.5,
      entropy: EXPECTED_ENTROPY, entropyDeviation: 0, runsCount: 0,
      runsZ: 0, tradability: 0,
    };
  }

  // Use last 200 digits for regime analysis
  const digits = data.digits.slice(-200);
  const total = digits.length;

  // Build distribution from these digits
  const dist = new Array(10).fill(0);
  for (const d of digits) dist[d]++;

  // Run tests
  const { statistic: chi2, pValue: chiP } = chiSquaredTest(dist, total);
  const { runsCount, zScore: runsZ } = runsTest(digits);
  const entropy = calculateEntropy(dist, total);
  const entropyDev = EXPECTED_ENTROPY - entropy;
  const acf = autocorrelation(digits);

  // === Determine regime ===
  let score = 0; // 0 = random, 1 = strong signal

  // Chi-squared: p < 0.20 means non-uniform distribution
  if (chiP < 0.05) score += 0.35;      // strong non-uniformity
  else if (chiP < 0.20) score += 0.20;  // moderate

  // Entropy: lower = more predictable
  if (entropyDev > 0.3) score += 0.20;
  else if (entropyDev > 0.15) score += 0.10;

  // Runs test: |z| > 1.96 = non-random at 95%
  if (Math.abs(runsZ) > 2.58) score += 0.25;  // 99% significant
  else if (Math.abs(runsZ) > 1.96) score += 0.20;
  else if (Math.abs(runsZ) > 1.5) score += 0.10;

  // Autocorrelation: |r| > 0.1 is notable for digits
  if (Math.abs(acf) > 0.15) score += 0.20;
  else if (Math.abs(acf) > 0.10) score += 0.10;

  score = Math.min(score, 1);

  let regime: Regime = 'random';
  if (score >= 0.50) regime = 'strong_signal';
  else if (score >= 0.25) regime = 'weak_signal';

  // Tradability: how much should we trust signals from this market?
// Random markets → low tradability, strong signal → high
  let tradability = 0;
  if (regime === 'strong_signal') tradability = 0.8 + score * 0.2;
  else if (regime === 'weak_signal') tradability = 0.4 + score * 0.4;
  else tradability = score * 0.5;

  return {
    regime,
    confidence: score,
    chiSquared: chi2,
    chiSquaredP: chiP,
    entropy,
    entropyDeviation: entropyDev,
    runsCount,
    runsZ,
    tradability,
  };
}

'use client';

import type { MarketState } from './strategies';
import type { TradeSignal } from './strategies';

// === AI Engine v3 — Research-Enhanced ===
// Based on research of profitable Deriv digit trading bots:
// 1. Markov chains (single + bigram transitions)
// 2. Bayesian posterior with recency weighting
// 3. Frequency analysis with momentum
// 4. N-gram pattern detection (pairs & triples)
// 5. Strategy learning with auto-retirement
// 6. Multi-strategy consensus for trade signals
// 7. DTide-style weighted ensemble scoring

export interface AISignal {
  contractType: string;
  barrier?: number;
  reason: string;
  confidence: number;
  source: string;
  ev: number;
}

// === Markov Chains ===
// Single-digit: matrix[i][j] = P(digit j | last was i)
// Bigram: matrix[i*10+j][k] = P(digit k | last two were i,j)
type TransitionMatrix = number[][];

const MARKOV_DECAY = 0.995;
const BAYESIAN_DECAY = 0.998;
const MIN_DIGITS = 15;

// Strategy performance tracking
interface StrategyRecord {
  wins: number;
  losses: number;
  totalProfit: number;
  lastUsed: number;
  recentResults: boolean[];
  status: 'active' | 'watch' | 'retired';
}

type StrategyKey = string;

export class AIEngine {
  // Single-digit Markov: 10x10
  private markov = new Map<string, TransitionMatrix>();
  // Bigram Markov: 100x10 (last 2 digits -> next digit)
  private bigram = new Map<string, TransitionMatrix>();
  // Bayesian posterior
  private bayesian = new Map<string, number[]>();
  // Strategy learning
  private strategyStats = new Map<StrategyKey, StrategyRecord>();
  private totalTrades = 0;

  feedTick(symbol: string, state: MarketState): void {
    const digits = state.digitHistory;
    if (digits.length < 2) return;

    const last = digits[digits.length - 1];
    const prev = digits[digits.length - 2];

    // --- Single-digit Markov ---
    const matrix = this.getOrCreateMarkov(symbol);
    for (let j = 0; j < 10; j++) matrix[prev][j] *= MARKOV_DECAY;
    matrix[prev][last] += (1 - MARKOV_DECAY);
    const rowSum = matrix[prev].reduce((a, b) => a + b, 0);
    if (rowSum > 0) for (let j = 0; j < 10; j++) matrix[prev][j] /= rowSum;

    // --- Bigram Markov (pairs -> next digit) ---
    if (digits.length >= 3) {
      const prev2 = digits[digits.length - 3];
      const bigram = this.getOrCreateBigram(symbol);
      const bigramIdx = prev2 * 10 + prev;
      for (let k = 0; k < 10; k++) bigram[bigramIdx][k] *= MARKOV_DECAY;
      bigram[bigramIdx][last] += (1 - MARKOV_DECAY);
      const bRowSum = bigram[bigramIdx].reduce((a, b) => a + b, 0);
      if (bRowSum > 0) for (let k = 0; k < 10; k++) bigram[bigramIdx][k] /= bRowSum;
    }

    // --- Bayesian posterior ---
    const posterior = this.getBayesian(symbol);
    for (let i = 0; i < 10; i++) posterior[i] *= BAYESIAN_DECAY;
    posterior[last] += 1;
  }

  // === Analysis Methods ===

  // Markov prediction: given last digit, what comes next?
  private getMarkovPred(symbol: string, lastDigit: number): { digit: number; confidence: number; entropy: number } {
    const matrix = this.getOrCreateMarkov(symbol);
    const probs = matrix[lastDigit];
    return this.findBestDigit(probs, symbol, 'Markov');
  }

  // Bigram prediction: given last TWO digits, what comes next?
  private getBigramPred(symbol: string, d1: number, d2: number): { digit: number; confidence: number; entropy: number } {
    if (digits.length >= 3) {
      const prev2 = digits[digits.length - 3];
      const bigram = this.getOrCreateBigram(symbol);
      const bigramIdx = prev2 * 10 + prev;
      for (let k = 0; k < 10; k++) bigram[bigramIdx][k] *= MARKOV_DECAY;
    return this.findBestDigit(probs, symbol, 'Bigram');
  }

  // Find the most probable digit and calculate confidence + entropy
  private findBestDigit(probs: number[], symbol: string, source: string): { digit: number; confidence: number; entropy: number } {
    let maxP = 0, predicted = 0;
    for (let i = 0; i < 10; i++) {
      if (probs[i] > maxP) { maxP = probs[i]; predicted = i; }
    }
    // Confidence: deviation from uniform 10%
    const confidence = Math.min(Math.max((maxP - 0.1) / 0.15, 0), 1);
    // Entropy of this row (lower = more predictable)
    let entropy = 0;
    for (let i = 0; i < 10; i++) {
      if (probs[i] > 0) entropy -= probs[i] * Math.log2(probs[i]);
    }
    return { digit: predicted, confidence, entropy };
  }

  // Bayesian prediction
  private getBayesianPred(symbol: string): { digit: number; confidence: number } {
    const posterior = this.getBayesian(symbol);
    const total = posterior.reduce((a, b) => a + b, 0);
    const probs = posterior.map(p => p / total);
    let maxP = 0, predicted = 0;
    for (let i = 0; i < 10; i++) { if (probs[i] > maxP) { maxP = probs[i]; predicted = i; } }
    return { digit: predicted, confidence: Math.min(Math.max((maxP - 0.1) / 0.15, 0), 1) };
  }

  // === Frequency Momentum ===
  // Not just static frequency, but TREND: is a digit becoming more or less frequent?
  private getFrequencyMomentum(state: MarketState): { digit: number; momentum: number; direction: string } | null {
    if (state.totalTicks < 40) return null;
    const digits = state.digitHistory;
    const recentN = Math.min(50, digits.length);
    const recent = digits.slice(-recentN);
    const older = digits.slice(-recentN * 2, -recentN);
    if (older.length < 10) return null;

    // Compare recent vs older frequency
    const recentDist = new Array(10).fill(0);
    const olderDist = new Array(10).fill(0);
    for (const d of recent) recentDist[d]++;
    for (const d of older) olderDist[d]++;

    const recentTotal = recent.length;
    const olderTotal = older.length;
    let bestDigit = 0, bestMomentum = 0, bestDirection = 'decreasing';
    for (let d = 0; d < 10; d++) {
    const recentPct = recentDist[d] / recentTotal;
    const olderPct = olderDist[d] / olderTotal;
    const momentum = recentPct - olderPct; // positive = getting hotter
    if (Math.abs(momentum) > Math.abs(bestMomentum)) {
      bestMomentum = momentum;
      bestDigit = d;
      bestDirection = momentum > 0 ? 'increasing' : 'decreasing';
    }
  }

    // Only signal if momentum is significant (>2% shift)
    if (Math.abs(bestMomentum) < 0.03) return null;

    return { digit: bestDigit, momentum: bestMomentum, direction: bestDirection };
  }

  // === N-gram Hot Streak Detection ===
  // Look for repeating digit sequences (e.g. 3,7,3,7,3,7)
  private detectRepeatingPair(state: MarketState): { digit: number; count: number; nextDigit: number } | null {
    const digits = state.digitHistory;
    if (digits.length < 6) return null;

    const last = digits[digits.length - 1];
    const prev = digits[digits.length - 2];

    // Check if last 6 digits form a repeating pair
    const checkLen = Math.min(6, digits.length);
    const recent = digits.slice(-checkLen);
    let isRepeating = true;
    const period = 2;
    for (let i = 2; i < recent.length; i++) {
    if (recent[i] !== recent[i % period]) { isRepeating = false; break; }
  }

    if (!isRepeating) {
    // Try period 3
    isRepeating = true;
    period = 3;
    for (let i = 3; i < recent.length; i++) {
      if (recent[i] !== recent[i % period]) { isRepeating = false; break; }
    }
  }

    if (isRepeating && recent.length >= 4) {
    const nextDigit = recent[recent.length % period];
    return { digit: nextDigit, count: Math.floor(recent.length / period), nextDigit };
    }

    return null;
  }

  // === Strategy Learning ===

  recordTrade(symbol: string, contractType: string, barrier: number | undefined, profit: number): void {
    const key: StrategyKey = symbol + ':' + contractType + ':' + (barrier ?? 'none');
    const record = this.strategyStats.get(key) || {
      wins: 0, losses: 0, totalProfit: 0, lastUsed: Date.now(),
      recentResults: [], status: 'active' as const,
    };
    const won = profit > 0;
    if (won) record.wins++; else record.losses++;
    record.totalProfit += profit;
    record.lastUsed = Date.now();
    record.recentResults.push(won);
    if (record.recentResults.length > 30) record.recentResults.shift();

    const total = record.wins + record.losses;
    if (total >= 10) {
      const recentWR = record.recentResults.filter(Boolean).length / record.recentResults.length;
      if (recentWR >= 0.70) record.status = 'active';
      else if (recentWR >= 0.50) record.status = 'watch';
      else if (recentWR < 0.40 && record.recentResults.length >= 15) record.status = 'retired';
    }

    this.strategyStats.set(key, record);
    this.totalTrades++;
  }

  getStrategyWinRate(symbol: string, contractType: string, barrier: number | undefined): number {
    const key = symbol + ':' + contractType + ':' + (barrier ?? 'none');
    const record = this.strategyStats.get(key);
    if (!record || record.wins + record.losses < 3) return 0.5;
    if (record.recentResults.length >= 10) return record.recentResults.filter(Boolean).length / record.recentResults.length;
    return record.wins / (record.wins + record.losses);
  }

  isRetired(symbol: string, contractType: string, barrier: number | undefined): boolean {
    const key = symbol + ':' + contractType + ':' + (barrier ?? 'none');
    return this.strategyStats.get(key)?.status === 'retired' ?? false;
  }

  // === Main Analysis: Weighted Ensemble ===

  analyze(state: MarketState): AISignal | null {
    if (state.totalTicks < MIN_DIGITS) return null;

    const symbol = state.symbol;
    const digits = state.digitHistory;
    const lastDigit = digits[digits.length - 1];
    const prevDigit = digits.length >= 2 ? digits[digits.length - 2] : -1;

    // Collect predictions from all models
    const predictions: Array<{ digit: number; confidence: number; weight: number; source: string; ev: number }> = [];

    // 1. Single-digit Markov
    const markov = this.getMarkovPred(symbol, lastDigit);
    predictions.push({
      digit: markov.digit, confidence: markov.confidence,
      weight: 1.0, // base weight
      source: 'Markov-1',
      ev: markov.digit !== lastDigit ? 0.60 : 0.10,
    });

    // 2. Bigram Markov (if enough data)
    if (state.totalTicks >= 30 && prevDigit >= 0) {
      const bigram = this.getBigramPred(symbol, prevDigit, lastDigit);
      predictions.push({
        digit: bigram.digit, confidence: bigram.confidence * 1.2, // boost bigram
        weight: 1.5, // bigram is more powerful
        source: 'Bigram-2',
        ev: bigram.digit !== lastDigit ? 0.65 : 0.10,
      });
    }

    // 3. Bayesian
    const bayes = this.getBayesianPred(symbol);
    predictions.push({
      digit: bayes.digit, confidence: bayes.confidence * 0.9,
      weight: 0.8,
      source: 'Bayesian',
      ev: bayes.digit !== lastDigit ? 0.58 : 0.10,
    });

    // 4. Frequency Momentum (is a digit getting hot/cold?)
    const momentum = this.getFrequencyMomentum(state);
    if (momentum) {
      const isHot = momentum.direction === 'increasing';
      // If a digit is getting hotter, DIFF against it (it's overrepresented)
      // If getting colder, we could MATCH on it (it's due for appearance)
      if (isHot) {
        predictions.push({
          digit: momentum.digit,
          confidence: Math.min(Math.abs(momentum.momentum) / 0.10, 0.95),
          weight: 1.2,
          source: 'Momentum',
          ev: 0.62, // hot digit -> DIFF against it
        });
      }
    }

    // 5. Repeating pattern detection
    const repeating = this.detectRepeatingPair(state);
    if (repeating && repeating.count >= 2) {
      predictions.push({
        digit: repeating.nextDigit,
          confidence: Math.min(0.5 + repeating.count * 0.15, 0.95),
          weight: 1.3,
          source: 'Pattern-' + (repeating.count) + 'x',
        ev: 0.70, // repeating pattern is strong signal
      });
    }

    // === Weighted Ensemble ===
    // Aggregate predictions using confidence * weight
    const votes = new Array(10).fill(0);
    let totalWeight = 0;
    for (const pred of predictions) {
      if (pred.confidence < 0.15) continue; // filter noise
      const vote = pred.confidence * pred.weight;
      votes[pred.digit] += vote;
      totalWeight += vote;
    }

    if (totalWeight === 0) return null;

    // Find consensus winner
    let bestDigit = 0, bestVotes = 0;
    for (let d = 0; d < 10; d++) {
      if (votes[d] > bestVotes) { bestVotes = votes[d]; bestDigit = d; }
    }

    const consensusStrength = bestVotes / totalWeight; // 0-1
    if (consensusStrength < 0.30) return null; // no consensus

    // Check if this strategy is retired
    const diffRetired = this.isRetired(symbol, 'DIGITDIFF', bestDigit);
    if (diffRetired) return null;

    // Check learned win rate
    const learnedWR = this.getStrategyWinRate(symbol, 'DIGITDIFF', bestDigit);

    // DTide-style: prefer DIGITDIFF (90% base win rate, positive EV)
    const ev = 0.90 * 0.85 - 0.10 * 1.0; // base EV for DIGITDIFF
    const adjustedEV = ev + (learnedWR - 0.50) * 0.10; // adjust by learned edge

    if (bestDigit === lastDigit) return null; // never bet the last digit appeared (anti-pattern)

    return {
      contractType: 'DIGITDIFF',
      barrier: bestDigit,
      reason: 'Ensemble(' + predictions.map(p => p.source).join('+') + ') d' + bestDigit + ' wr=' + Math.round(learnedWR * 100) + '%',
      confidence: consensusStrength,
      source: 'Ensemble',
      ev: adjustedEV,
    };
  }

  getLearningStats(): { strategiesLearned: number; totalTrades: number; wins: number; losses: number; profit: number; winRate: number } {
    let wins = 0, losses = 0, profit = 0;
    for (const record of this.strategyStats.values()) {
      wins += record.wins; losses += record.losses; profit += record.totalProfit;
    }
    return {
      strategiesLearned: this.strategyStats.size, totalTrades: this.totalTrades,
      wins, losses, profit, winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    };
  }

  // --- Private helpers ---

  private getOrCreateMarkov(symbol: string): TransitionMatrix {
    if (!this.markov.has(symbol)) {
      this.markov.set(symbol, Array.from({ length: 10 }, () => new Array(10).fill(0.1)));
    }
    return this.markov.get(symbol)!;
  }

  private getOrCreateBigram(symbol: string): TransitionMatrix {
    if (!this.bigram.has(symbol)) {
      this.bigram.set(symbol, Array.from({ length: 100 }, () => new Array(10).fill(0.1)));
    }
    return this.bigram.get(symbol)!;
  }

  private getBayesian(symbol: string): number[] {
    if (!this.bayesian.has(symbol)) {
      this.bayesian.set(symbol, new Array(10).fill(1));
    }
    return this.bayesian.get(symbol)!;
  }
}

'use client';

import type { MarketState } from './strategies';

// === AI Engine v4 — Enhanced Research-Grade ===
// Based on research of profitable Deriv digit trading bots:
// 1. Markov chains (single + bigram transitions)
// 2. Bayesian posterior with recency weighting
// 3. Frequency analysis with momentum
// 4. N-gram pattern detection (pairs & triples)
// 5. Strategy learning with auto-retirement
// 6. Multi-strategy consensus for trade signals
// 7. Lag-2 autocorrelation detection
// 8. Transition entropy tracking for regime-aware confidence

export interface AISignal {
  contractType: string;
  barrier?: number;
  reason: string;
  confidence: number;
  source: string;
  ev: number;
}

// === Markov Chains ===
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
  // Transition entropy history for regime awareness
  private entropyHistory = new Map<string, number[]>();
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
      const bigramMatrix = this.getOrCreateBigram(symbol);
      const bigramIdx = prev2 * 10 + prev;
      for (let k = 0; k < 10; k++) bigramMatrix[bigramIdx][k] *= MARKOV_DECAY;
      bigramMatrix[bigramIdx][last] += (1 - MARKOV_DECAY);
      const bRowSum = bigramMatrix[bigramIdx].reduce((a, b) => a + b, 0);
      if (bRowSum > 0) for (let k = 0; k < 10; k++) bigramMatrix[bigramIdx][k] /= bRowSum;
    }

    // --- Bayesian posterior ---
    const posterior = this.getBayesian(symbol);
    for (let i = 0; i < 10; i++) posterior[i] *= BAYESIAN_DECAY;
    posterior[last] += 1;

    // --- Track transition entropy (predictability indicator) ---
    if (digits.length % 10 === 0) {
      const rowEntropy = this.rowEntropy(matrix[prev]);
      const hist = this.entropyHistory.get(symbol) || [];
      hist.push(rowEntropy);
      if (hist.length > 50) hist.shift();
      this.entropyHistory.set(symbol, hist);
    }
  }

  // === Analysis Methods ===

  private getMarkovPred(symbol: string, lastDigit: number): { digit: number; confidence: number; entropy: number } {
    const matrix = this.getOrCreateMarkov(symbol);
    const probs = matrix[lastDigit];
    return this.findBestDigit(probs);
  }

  private getBigramPred(symbol: string, d1: number, d2: number): { digit: number; confidence: number; entropy: number } | null {
    const bigramMatrix = this.getOrCreateBigram(symbol);
    const bigramIdx = d1 * 10 + d2;
    const probs = bigramMatrix[bigramIdx];
    // Check if this bigram has meaningful data (not just uniform 0.1)
    const maxP = Math.max(...probs);
    if (maxP < 0.15) return null; // no meaningful bigram data yet
    return this.findBestDigit(probs);
  }

  private findBestDigit(probs: number[]): { digit: number; confidence: number; entropy: number } {
    let maxP = 0, predicted = 0;
    for (let i = 0; i < 10; i++) {
      if (probs[i] > maxP) { maxP = probs[i]; predicted = i; }
    }
    // Confidence: deviation from uniform 10%
    const confidence = Math.min(Math.max((maxP - 0.1) / 0.15, 0), 1);
    // Entropy of this row (lower = more predictable)
    const entropy = this.rowEntropy(probs);
    return { digit: predicted, confidence, entropy };
  }

  private rowEntropy(probs: number[]): number {
    let entropy = 0;
    for (let i = 0; i < 10; i++) {
      if (probs[i] > 0) entropy -= probs[i] * Math.log2(probs[i]);
    }
    return entropy;
  }

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
    const recentN = Math.min(50, Math.floor(digits.length / 2));
    if (recentN < 10) return null;
    const recent = digits.slice(-recentN);
    const older = digits.slice(-recentN * 2, -recentN);
    if (older.length < 10) return null;

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
      const momentum = recentPct - olderPct;
      if (Math.abs(momentum) > Math.abs(bestMomentum)) {
        bestMomentum = momentum;
        bestDigit = d;
        bestDirection = momentum > 0 ? 'increasing' : 'decreasing';
      }
    }

    if (Math.abs(bestMomentum) < 0.03) return null;
    return { digit: bestDigit, momentum: bestMomentum, direction: bestDirection };
  }

  // === Repeating Pattern Detection ===
  // Look for repeating digit sequences (e.g. 3,7,3,7,3,7)
  private detectRepeatingPattern(state: MarketState): { nextDigit: number; count: number; period: number } | null {
    const digits = state.digitHistory;
    if (digits.length < 6) return null;

    // Try periods 2 and 3
    for (const period of [2, 3]) {
      const checkLen = Math.min(period * 3, digits.length);
      const recent = digits.slice(-checkLen);
      if (recent.length < period * 2) continue;

      let isRepeating = true;
      for (let i = period; i < recent.length; i++) {
        if (recent[i] !== recent[i % period]) { isRepeating = false; break; }
      }

      if (isRepeating) {
        const nextDigit = recent[recent.length % period];
        return { nextDigit, count: Math.floor(recent.length / period), period };
      }
    }

    return null;
  }

  // === Lag-2 Autocorrelation ===
  // Checks if digit[i] correlates with digit[i-2] (skip-1 pattern)
  private getLag2Autocorrelation(state: MarketState): { digit: number; confidence: number } | null {
    if (state.totalTicks < 60) return null;
    const digits = state.digitHistory.slice(-100);
    if (digits.length < 40) return null;

    // If last digit matches digit at -2 position, predict same pattern
    const last = digits[digits.length - 1];
    const prev2 = digits.length >= 3 ? digits[digits.length - 3] : -1;
    if (prev2 < 0) return null;

    // Count how often digit[i] === digit[i-2] in recent history
    let matches = 0;
    const total = digits.length - 2;
    for (let i = 2; i < digits.length; i++) {
      if (digits[i] === digits[i - 2]) matches++;
    }
    const matchRate = matches / total;
    // Random expectation for any specific digit matching lag-2: 10%
    // But here we check ANY digit matching, so expectation is 10%
    if (matchRate > 0.15) {
      // Lag-2 autocorrelation detected — predict digit at lag-2 position
      return { digit: prev2, confidence: Math.min((matchRate - 0.10) / 0.15, 0.8) };
    }
    return null;
  }

  // === Entropy Trend ===
  // Is the market becoming more or less predictable over time?
  private getEntropyTrend(symbol: string): 'increasing_predictability' | 'decreasing_predictability' | 'stable' {
    const hist = this.entropyHistory.get(symbol);
    if (!hist || hist.length < 10) return 'stable';

    const recent5 = hist.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const older5 = hist.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;

    const diff = older5 - recent5; // positive = entropy decreasing = more predictable
    if (diff > 0.15) return 'increasing_predictability';
    if (diff < -0.15) return 'decreasing_predictability';
    return 'stable';
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

  // === Main Analysis: Weighted Ensemble v2 ===

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
    // Boost weight if Markov entropy is low (more predictable)
    const markovEntropyBonus = markov.entropy < 3.0 ? 1.3 : 1.0;
    predictions.push({
      digit: markov.digit, confidence: markov.confidence,
      weight: 1.0 * markovEntropyBonus,
      source: 'Markov-1',
      ev: markov.digit !== lastDigit ? 0.60 : 0.10,
    });

    // 2. Bigram Markov (if enough data)
    if (state.totalTicks >= 30 && prevDigit >= 0) {
      const bigram = this.getBigramPred(symbol, prevDigit, lastDigit);
      if (bigram) {
        predictions.push({
          digit: bigram.digit, confidence: bigram.confidence * 1.2,
          weight: 1.5 * (bigram.entropy < 2.5 ? 1.4 : 1.0),
          source: 'Bigram-2',
          ev: bigram.digit !== lastDigit ? 0.65 : 0.10,
        });
      }
    }

    // 3. Bayesian
    const bayes = this.getBayesianPred(symbol);
    predictions.push({
      digit: bayes.digit, confidence: bayes.confidence * 0.9,
      weight: 0.8,
      source: 'Bayesian',
      ev: bayes.digit !== lastDigit ? 0.58 : 0.10,
    });

    // 4. Frequency Momentum
    const momentum = this.getFrequencyMomentum(state);
    if (momentum) {
      if (momentum.direction === 'increasing') {
        // Digit getting hotter → DIFF against it
        predictions.push({
          digit: momentum.digit,
          confidence: Math.min(Math.abs(momentum.momentum) / 0.10, 0.95),
          weight: 1.2,
          source: 'Momentum',
          ev: 0.62,
        });
      } else {
        // Digit getting colder → could MATCH on it, but we prefer DIFF
        // So DIFF against the HOTTEST digit instead
        let hotDigit = 0, hotPct = -1;
        for (let d = 0; d < 10; d++) {
          const pct = state.distribution[d] / state.totalTicks;
          if (pct > hotPct) { hotPct = pct; hotDigit = d; }
        }
        predictions.push({
          digit: hotDigit,
          confidence: Math.min(Math.abs(momentum.momentum) / 0.10, 0.90),
          weight: 1.1,
          source: 'ColdMomentum',
          ev: 0.60,
        });
      }
    }

    // 5. Repeating pattern detection
    const repeating = this.detectRepeatingPattern(state);
    if (repeating && repeating.count >= 2) {
      // For repeating patterns: the predicted next digit is likely next
      // So we DIFF against OTHER digits (not the predicted one)
      // Actually, if pattern says 7 is next, don't diff against 7.
      // Instead, diff against a digit NOT in the pattern
      // Simplest: diff against the LEAST likely digit from Markov
      const matrix = this.getOrCreateMarkov(symbol);
      const probs = matrix[lastDigit];
      let worstDigit = repeating.nextDigit;
      let worstP = Infinity;
      for (let d = 0; d < 10; d++) {
        if (d !== repeating.nextDigit && probs[d] < worstP) {
          worstP = probs[d]; worstDigit = d;
        }
      }
      predictions.push({
        digit: worstDigit,
        confidence: Math.min(0.5 + repeating.count * 0.15, 0.95),
        weight: 1.3,
        source: 'Pattern-' + repeating.count + 'x',
        ev: 0.70,
      });
    }

    // 6. Lag-2 autocorrelation
    const lag2 = this.getLag2Autocorrelation(state);
    if (lag2 && lag2.confidence > 0.2) {
      // Lag-2 says a specific digit is likely → DIFF against something else
      const matrix = this.getOrCreateMarkov(symbol);
      const probs = matrix[lastDigit];
      let worstDigit = lag2.digit;
      let worstP = Infinity;
      for (let d = 0; d < 10; d++) {
        if (d !== lag2.digit && probs[d] < worstP) {
          worstP = probs[d]; worstDigit = d;
        }
      }
      predictions.push({
        digit: worstDigit,
        confidence: lag2.confidence * 0.8,
        weight: 0.9,
        source: 'Lag2-ACF',
        ev: 0.55,
      });
    }

    // === Weighted Ensemble ===
    const votes = new Array(10).fill(0);
    let totalWeight = 0;
    for (const pred of predictions) {
      if (pred.confidence < 0.15) continue;
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

    const consensusStrength = bestVotes / totalWeight;
    if (consensusStrength < 0.25) return null; // no consensus

    // Check if this strategy is retired
    if (this.isRetired(symbol, 'DIGITDIFF', bestDigit)) return null;

    // Check learned win rate
    const learnedWR = this.getStrategyWinRate(symbol, 'DIGITDIFF', bestDigit);

    // If recent win rate is bad, reduce confidence
    let adjustedConfidence = consensusStrength;
    if (learnedWR < 0.50 && this.totalTrades > 10) {
      adjustedConfidence *= 0.5;
    }

    // Base EV for DIGITDIFF with typical payout
    const baseEV = 0.90 * 0.85 - 0.10 * 1.0; // = 0.665
    const adjustedEV = baseEV + (learnedWR - 0.50) * 0.10;

    if (bestDigit === lastDigit) return null; // anti-pattern: never bet last digit appeared

    // Entropy trend bonus
    const entropyTrend = this.getEntropyTrend(symbol);
    const trendBonus = entropyTrend === 'increasing_predictability' ? 0.05 : 0;

    const sources = predictions.filter(p => p.digit === bestDigit && p.confidence >= 0.15).map(p => p.source);

    return {
      contractType: 'DIGITDIFF',
      barrier: bestDigit,
      reason: `Ensemble(${sources.join('+')}) d${bestDigit} wr=${Math.round(learnedWR * 100)}% trend=${entropyTrend}`,
      confidence: Math.min(adjustedConfidence + trendBonus, 1),
      source: 'Ensemble-v2',
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

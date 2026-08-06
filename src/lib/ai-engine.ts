'use client';

import type { MarketData, MarketSymbol } from './multi-market-ws';
import type { TradeSignal } from './logic-engine';

// === AI Engine ===
// Statistical AI that learns from every trade to improve future decisions.
// Uses Markov chains, entropy analysis, Bayesian updating, and strategy learning.

export interface AIScore {
  score: number;            // 0-100
  signal: TradeSignal | null;
  components: {
    markovScore: number;    // 0-30 — next-digit prediction confidence
    entropyScore: number;   // 0-25 — lower entropy = more predictable
    bayesianScore: number;  // 0-25 — posterior probability strength
    learningScore: number;  // 0-20 — based on historical win rate of strategy+market
  };
  markovPrediction?: number;  // AI's predicted next digit
  entropyValue?: number;     // actual entropy in bits
}

// Per-market Markov transition matrix (10x10)
// matrix[i][j] = P(digit j | last digit was i)
type TransitionMatrix = number[][];

// Strategy performance tracking (THE LEARNING)
interface StrategyRecord {
  wins: number;
  losses: number;
  totalProfit: number;
  lastUsed: number;
}

type StrategyKey = string; // `${symbol}:${contractType}:${barrier}`

const MIN_DIGITS_FOR_AI = 50;
const EXPECTED_ENTROPY = 3.32193; // log2(10) — entropy of uniform distribution
const MARKOV_DECAY = 0.995;       // EMA decay for Markov updates (recent data weighted more)
const BAYESIAN_PSEUDO_COUNT = 2;  // Pseudo-count for Bayesian prior (smoothing)
const MAX_TRADE_MEMORY = 500;     // Max trade history to keep per strategy

class AIEngine {
  // Markov chains per market
  private markov: Map<string, TransitionMatrix> = new Map();

  // Bayesian posterior per market: posterior[i] = P(digit i) after observations
  private bayesian: Map<string, number[]> = new Map();

  // Strategy performance (LEARNING)
  private strategyStats: Map<StrategyKey, StrategyRecord> = new Map();

  // Total trades for learning cooldown
  private totalTradesRecorded = 0;

  // Load persisted learning data from localStorage
  loadLearningData() {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem('wp-ai-learning');
      if (saved) {
        const data = JSON.parse(saved);
        if (data.strategyStats) {
          this.strategyStats = new Map(Object.entries(data.strategyStats));
        }
        this.totalTradesRecorded = data.totalTradesRecorded || 0;
        console.log('[AI] Loaded learning data:', this.strategyStats.size, 'strategies,', this.totalTradesRecorded, 'trades');
      }
    } catch { /* ignore */ }
  }

  // Persist learning data
  private saveLearningData() {
    if (typeof window === 'undefined') return;
    try {
      const data = {
        strategyStats: Object.fromEntries(this.strategyStats),
        totalTradesRecorded: this.totalTradesRecorded,
      };
      localStorage.setItem('wp-ai-learning', JSON.stringify(data));
    } catch { /* ignore */ }
  }

  // === MARKOV CHAIN ===

  private getMarkov(symbol: string): TransitionMatrix {
    if (!this.markov.has(symbol)) {
      // Initialize with uniform distribution
      const matrix: TransitionMatrix = Array.from({ length: 10 }, () =>
        new Array(10).fill(0.1)
      );
      this.markov.set(symbol, matrix);
    }
    return this.markov.get(symbol)!;
  }

  // Update Markov matrix with a new observation (digit transition)
  updateMarkov(symbol: string, fromDigit: number, toDigit: number) {
    const matrix = this.getMarkov(symbol);
    // Apply exponential decay to all transitions from fromDigit (fade old data)
    for (let j = 0; j < 10; j++) {
      matrix[fromDigit][j] *= MARKOV_DECAY;
    }
    // Boost the observed transition
    matrix[fromDigit][toDigit] += (1 - MARKOV_DECAY);
    // Re-normalize the row
    const rowSum = matrix[fromDigit].reduce((a, b) => a + b, 0);
    if (rowSum > 0) {
      for (let j = 0; j < 10; j++) {
        matrix[fromDigit][j] /= rowSum;
      }
    }
  }

  // Get Markov prediction: given last digit, what's the most likely next digit?
  getMarkovPrediction(symbol: string, lastDigit: number): { digit: number; confidence: number; probabilities: number[] } {
    const matrix = this.getMarkov(symbol);
    const probs = matrix[lastDigit];
    let maxProb = 0, predictedDigit = 0;
    for (let i = 0; i < 10; i++) {
      if (probs[i] > maxProb) { maxProb = probs[i]; predictedDigit = i; }
    }
    // Confidence = how much the prediction deviates from uniform (10%)
    const confidence = Math.max(0, (maxProb - 0.1) / 0.15); // 0 at 10%, 1 at 25%+
    return { digit: predictedDigit, confidence: Math.min(confidence, 1), probabilities: [...probs] };
  }

  // === ENTROPY ANALYSIS ===

  // Shannon entropy of the digit distribution
  calculateEntropy(data: MarketData): { entropy: number; deviation: number } {
    const total = data.digits.length || 1;
    let entropy = 0;
    for (let i = 0; i < 10; i++) {
      const p = data.distribution[i] / total;
      if (p > 0) {
        entropy -= p * Math.log2(p);
      }
    }
    // Deviation from expected: lower entropy = more predictable = higher score
    const deviation = EXPECTED_ENTROPY - entropy; // positive = more predictable than random
    return { entropy, deviation };
  }

  // === BAYESIAN UPDATING ===

  private getBayesian(symbol: string): number[] {
    if (!this.bayesian.has(symbol)) {
      this.bayesian.set(symbol, new Array(10).fill(1)); // Dirichlet prior: all 1s
    }
    return this.bayesian.get(symbol)!;
  }

  // Update posterior with observed digit (recency-weighted)
  updateBayesian(symbol: string, digit: number) {
    const posterior = this.getBayesian(symbol);
    // Decay all counts slightly (recency weighting)
    for (let i = 0; i < 10; i++) {
      posterior[i] *= 0.998;
    }
    // Increment observed digit
    posterior[digit] += 1;
  }

  // Get Bayesian prediction
  getBayesianPrediction(symbol: string): { digit: number; confidence: number; probabilities: number[] } {
    const posterior = this.getBayesian(symbol);
    const total = posterior.reduce((a, b) => a + b, 0);
    const probs = posterior.map(p => p / total);

    let maxProb = 0, predictedDigit = 0;
    for (let i = 0; i < 10; i++) {
      if (probs[i] > maxProb) { maxProb = probs[i]; predictedDigit = i; }
    }
    const confidence = Math.max(0, (maxProb - 0.1) / 0.15);
    return { digit: predictedDigit, confidence: Math.min(confidence, 1), probabilities: probs };
  }

  // === STRATEGY LEARNING (THE CORE LEARNING SYSTEM) ===

  // Record a trade result so AI learns from it
  recordTradeResult(symbol: string, contractType: string, barrier: number | undefined, profit: number, signalStrength: number) {
    const key: StrategyKey = `${symbol}:${contractType}:${barrier ?? 'none'}`;
    const record = this.strategyStats.get(key) || { wins: 0, losses: 0, totalProfit: 0, lastUsed: Date.now() };

    if (profit > 0) record.wins++;
    else record.losses++;
    record.totalProfit += profit;
    record.lastUsed = Date.now();

    this.strategyStats.set(key, record);
    this.totalTradesRecorded++;

    // Persist every 5 trades
    if (this.totalTradesRecorded % 5 === 0) {
      this.saveLearningData();
    }
  }

  // Get the learned win rate for a specific strategy+market combo
  getStrategyWinRate(symbol: string, contractType: string, barrier: number | undefined): number {
    const key: StrategyKey = `${symbol}:${contractType}:${barrier ?? 'none'}`;
    const record = this.strategyStats.get(key);
    if (!record || record.wins + record.losses < 3) return 0.5; // No data yet, assume 50%
    return record.wins / (record.wins + record.losses);
  }

  // Get the overall best-performing strategy for a market
  getBestStrategyForMarket(symbol: string): { contractType: string; barrier: number; winRate: number } | null {
    let best: { contractType: string; barrier: number; winRate: number; totalTrades: number } | null = null;

    for (const [key, record] of this.strategyStats) {
      if (!key.startsWith(symbol + ':')) continue;
      const total = record.wins + record.losses;
      if (total < 3) continue;

      const winRate = record.wins / total;
      if (!best || winRate > best.winRate) {
        const parts = key.split(':');
        best = {
          contractType: parts[1],
          barrier: parts[2] === 'none' ? -1 : parseInt(parts[2]),
          winRate,
          totalTrades: total,
        };
      }
    }
    return best;
  }

  // === BATCH UPDATE (called on each tick) ===

  // Feed new tick data into the AI models
  processTick(symbol: string, data: MarketData) {
    if (data.digits.length < 2) return;

    const len = data.digits.length;
    const lastDigit = data.digits[len - 1];
    const prevDigit = data.digits[len - 2];

    // Update Markov (transition from prev → last)
    this.updateMarkov(symbol, prevDigit, lastDigit);

    // Update Bayesian posterior
    this.updateBayesian(symbol, lastDigit);
  }

  // === MAIN AI SCORING ===

  analyzeMarket(data: MarketData): AIScore {
    if (data.digits.length < MIN_DIGITS_FOR_AI) {
      return { score: 0, signal: null, components: { markovScore: 0, entropyScore: 0, bayesianScore: 0, learningScore: 0 } };
    }

    const symbol = data.symbol;
    const lastDigit = data.digits[data.digits.length - 1];

    // --- Markov Score (0-30) ---
    const markovPred = this.getMarkovPrediction(symbol, lastDigit);
    const markovScore = Math.round(markovPred.confidence * 30);

    // --- Entropy Score (0-25) ---
    const { entropy, deviation } = this.calculateEntropy(data);
    // More deviation from expected entropy = more predictable = higher score
    const entropyNorm = Math.max(0, Math.min(deviation / 0.5, 1)); // 0.5 bits deviation = max score
    const entropyScore = Math.round(entropyNorm * 25);

    // --- Bayesian Score (0-25) ---
    const bayesPred = this.getBayesianPrediction(symbol, lastDigit);
    const bayesScore = Math.round(bayesPred.confidence * 25);

    // --- Learning Score (0-20) ---
    // Based on historical performance of strategies on this market
    let learningScore = 10; // baseline
    const bestStrat = this.getBestStrategyForMarket(symbol);
    if (bestStrat && bestStrat.totalTrades >= 5) {
      // Scale: 50% win rate = 10pts, 70%+ = 20pts, 30%- = 0pts
      learningScore = Math.round(Math.max(0, Math.min((bestStrat.winRate - 0.3) / 0.4, 1)) * 20);
    }

    // --- Generate AI Signal ---
    let signal: TradeSignal | null = null;

    // Use the prediction source with highest confidence
    const sources = [
      { pred: markovPred, name: 'Markov' },
      { pred: bayesPred, name: 'Bayesian' },
    ];
    const bestSource = sources.reduce((a, b) => b.pred.confidence > a.pred.confidence ? b : a);

    if (bestSource.pred.confidence > 0.3) {
      const predictedDigit = bestSource.pred.digit;
      const winRate = this.getStrategyWinRate(symbol, 'DIGITMATCH', predictedDigit);
      const diffWinRate = this.getStrategyWinRate(symbol, 'DIGITDIFF', predictedDigit);

      // AI decides between MATCH and DIFFER based on learned performance
      if (diffWinRate > winRate && diffWinRate > 0.5) {
        signal = {
          contractType: 'DIGITDIFF',
          barrier: predictedDigit,
          reason: `AI ${bestSource.name}: d${predictedDigit} differ (learned ${Math.round(diffWinRate * 100)}% win)`,
          confidence: bestSource.pred.confidence,
        };
      } else {
        signal = {
          contractType: 'DIGITMATCH',
          barrier: predictedDigit,
          reason: `AI ${bestSource.name}: d${predictedDigit} match (conf ${Math.round(bestSource.pred.confidence * 100)}%)`,
          confidence: bestSource.pred.confidence,
        };
      }
    }

    const totalScore = markovScore + entropyScore + bayesScore + learningScore;

    return {
      score: totalScore,
      signal,
      components: { markovScore, entropyScore, bayesianScore, learningScore },
      markovPrediction: markovPred.digit,
      entropyValue: entropy,
    };
  }

  // Get learning stats for UI display
  getLearningStats() {
    let totalWins = 0, totalLosses = 0, totalProfit = 0;
    for (const record of this.strategyStats.values()) {
      totalWins += record.wins;
      totalLosses += record.losses;
      totalProfit += record.totalProfit;
    }
    return {
      strategiesLearned: this.strategyStats.size,
      totalTradesRecorded: this.totalTradesRecorded,
      totalWins,
      totalLosses,
      totalProfit,
      winRate: totalWins + totalLosses > 0 ? totalWins / (totalWins + totalLosses) : 0,
    };
  }
}

// Singleton instance
export const aiEngine = new AIEngine();

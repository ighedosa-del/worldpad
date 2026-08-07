'use client';

import type { MarketState } from './strategies';
import type { TradeSignal } from './strategies';

// === AI Engine v2 (No React) ===
// Markov chains + Bayesian updating + strategy learning.
// Learns from every trade to improve future decisions.

export interface AISignal {
  contractType: string;
  barrier?: number;
  reason: string;
  confidence: number;
  source: string;
}

type TransitionMatrix = number[][];

interface StrategyRecord {
  wins: number;
  losses: number;
  totalProfit: number;
  lastUsed: number;
  recentResults: boolean[];
  status: 'active' | 'watch' | 'retired';
}

type StrategyKey = string;

const MARKOV_DECAY = 0.995;
const MIN_DIGITS_FOR_AI = 20;

export class AIEngine {
  private markov = new Map<string, TransitionMatrix>();
  private bayesian = new Map<string, number[]>();
  private strategyStats = new Map<StrategyKey, StrategyRecord>();
  private totalTrades = 0;

  // --- Markov Chain ---

  private getMarkov(symbol: string): TransitionMatrix {
    if (!this.markov.has(symbol)) {
      this.markov.set(symbol, Array.from({ length: 10 }, () => new Array(10).fill(0.1)));
    }
    return this.markov.get(symbol)!;
  }

  feedTick(symbol: string, state: MarketState): void {
    const digits = state.digitHistory;
    if (digits.length < 2) return;
    const last = digits[digits.length - 1];
    const prev = digits[digits.length - 2];

    // Update Markov
    const matrix = this.getMarkov(symbol);
    for (let j = 0; j < 10; j++) matrix[prev][j] *= MARKOV_DECAY;
    matrix[prev][last] += (1 - MARKOV_DECAY);
    const rowSum = matrix[prev].reduce((a, b) => a + b, 0);
    if (rowSum > 0) for (let j = 0; j < 10; j++) matrix[prev][j] /= rowSum;

    // Update Bayesian
    if (!this.bayesian.has(symbol)) this.bayesian.set(symbol, new Array(10).fill(1));
    const posterior = this.bayesian.get(symbol)!;
    for (let i = 0; i < 10; i++) posterior[i] *= 0.998;
    posterior[last] += 1;
  }

  getMarkovPrediction(symbol: string, lastDigit: number): { digit: number; confidence: number } {
    const matrix = this.getMarkov(symbol);
    const probs = matrix[lastDigit];
    let maxProb = 0, predicted = 0;
    for (let i = 0; i < 10; i++) {
      if (probs[i] > maxProb) { maxProb = probs[i]; predicted = i; }
    }
    return { digit: predicted, confidence: Math.min(Math.max((maxProb - 0.1) / 0.15, 0), 1) };
  }

  getBayesianPrediction(symbol: string): { digit: number; confidence: number } {
    const posterior = this.bayesian.get(symbol);
    if (!posterior) return { digit: 0, confidence: 0 };
    const total = posterior.reduce((a, b) => a + b, 0);
    const probs = posterior.map(p => p / total);
    let maxProb = 0, predicted = 0;
    for (let i = 0; i < 10; i++) {
      if (probs[i] > maxProb) { maxProb = probs[i]; predicted = i; }
    }
    return { digit: predicted, confidence: Math.min(Math.max((maxProb - 0.1) / 0.15, 0), 1) };
  }

  // --- Strategy Learning ---

  recordTrade(symbol: string, contractType: string, barrier: number | undefined, profit: number): void {
    const key: StrategyKey = `${symbol}:${contractType}:${barrier ?? 'none'}`;
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
    if (total >= 15) {
      const recentWR = record.recentResults.filter(Boolean).length / record.recentResults.length;
      if (recentWR >= 0.70) record.status = 'active';
      else if (recentWR >= 0.50) record.status = 'watch';
      else if (recentWR < 0.40 && record.recentResults.length >= 20) record.status = 'retired';
    }

    this.strategyStats.set(key, record);
    this.totalTrades++;
  }

  getStrategyWinRate(symbol: string, contractType: string, barrier: number | undefined): number {
    const key = `${symbol}:${contractType}:${barrier ?? 'none'}`;
    const record = this.strategyStats.get(key);
    if (!record || record.wins + record.losses < 3) return 0.5;
    if (record.recentResults.length >= 10) {
      return record.recentResults.filter(Boolean).length / record.recentResults.length;
    }
    return record.wins / (record.wins + record.losses);
  }

  isRetired(symbol: string, contractType: string, barrier: number | undefined): boolean {
    const key = `${symbol}:${contractType}:${barrier ?? 'none'}`;
    return this.strategyStats.get(key)?.status === 'retired' ?? false;
  }

  // --- Main AI Analysis ---

  analyze(state: MarketState): AISignal | null {
    if (state.totalTicks < MIN_DIGITS_FOR_AI) return null;

    const symbol = state.symbol;
    const lastDigit = state.digitHistory[state.digitHistory.length - 1];
    if (lastDigit === undefined) return null;

    // Get predictions from both models
    const markov = this.getMarkovPrediction(symbol, lastDigit);
    const bayes = this.getBayesianPrediction(symbol);
    const best = markov.confidence > bayes.confidence
      ? { ...markov, source: 'Markov' }
      : { ...bayes, source: 'Bayesian' };

    if (best.confidence < 0.25) return null;

    // Prefer DIGITDIFF (90% base win rate = positive EV)
    const diffRetired = this.isRetired(symbol, 'DIGITDIFF', best.digit);
    const diffWR = this.getStrategyWinRate(symbol, 'DIGITDIFF', best.digit);

    if (!diffRetired) {
      return {
        contractType: 'DIGITDIFF',
        barrier: best.digit,
        reason: `AI ${best.source}: d${best.digit} (learned ${Math.round(diffWR * 100)}%)`,
        confidence: best.confidence,
        source: 'ai',
      };
    }

    return null;
  }

  getLearningStats(): { strategiesLearned: number; totalTrades: number; wins: number; losses: number; profit: number; winRate: number } {
    let wins = 0, losses = 0, profit = 0;
    for (const record of this.strategyStats.values()) {
      wins += record.wins;
      losses += record.losses;
      profit += record.totalProfit;
    }
    return {
      strategiesLearned: this.strategyStats.size,
      totalTrades: this.totalTrades,
      wins, losses, profit,
      winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    };
  }
}

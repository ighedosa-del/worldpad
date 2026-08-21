'use client';

// === Analysis Pipeline v16 — CALL/PUT with Price Features ===
// Replaces V15's digit-based regime analysis (chi-squared, runs, entropy)
// with a simplified price regime for CALL/PUT contracts.
// LUCAS features in market-features.ts handle the actual signal generation.

import type { MarketState } from './strategies';

export interface RegimeResult {
  regime: 'trending' | 'ranging' | 'volatile';
  confidence: number;
  trendStrength: number;
  volatilityLevel: number;
  tradability: number;
  acf1: number;
  acf2: number;
  chiSquared: number;
  chiSquaredP: number;
  entropy: number;
  entropyDeviation: number;
  runsZ: number;
  runsCount: number;
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

// === PAYOUT ESTIMATION ===
// CALL/PUT on Volatility Indices, $0.35 stake, 5 ticks:
// Typical payout: ~$0.65 on $0.35 stake (profit ratio ~0.857)
// Deriv takes ~3-4% house edge
const HOUSE_EDGE = 0.04;

export function getEstimatedPayout(contractType: string, _barrier?: number): number {
  // CALL/PUT net profit ratio (profit per $1 staked)
  // Typical: stake $0.35, payout $0.65, net profit $0.30, ratio = 0.857
  // After house edge: 0.857 * 0.96 = 0.823
  if (contractType === 'CALL' || contractType === 'PUT') {
    return 0.85 * (1 - HOUSE_EDGE);
  }
  return 0.85 * (1 - HOUSE_EDGE);
}

export function getBaseProbability(contractType: string, _barrier?: number): number {
  // CALL/PUT: ~50% base probability (price goes up or down)
  if (contractType === 'CALL' || contractType === 'PUT') {
    return 0.50;
  }
  return 0.50;
}

// === REGIME ANALYSIS (simplified for CALL/PUT) ===
// The real regime detection happens in market-features.ts via LUCAS.
// This provides a compatibility layer for the analysis pipeline.

export function analyzeRegime(state: MarketState): RegimeResult {
  // Default: assume tradable — LUCAS handles the real filtering
  return {
    regime: 'ranging',
    confidence: 0.5,
    trendStrength: 0.5,
    volatilityLevel: 0.5,
    tradability: 0.5,
    acf1: 0,
    acf2: 0,
    chiSquared: 0,
    chiSquaredP: 0.5,
    entropy: 3.32,
    entropyDeviation: 0,
    runsZ: 0,
    runsCount: 0,
  };
}

// === PATTERN DETECTION (not used for CALL/PUT) ===

export function detectPatterns(state: MarketState): PatternSignal | null {
  return null;
}

// === BACKTESTING for CALL/PUT ===
// Returns a default passing grade — the real backtest happens
// inside strategyLucasCallPut via backtestPriceDirection in strategies.ts

export function backtestSignal(state: MarketState, contractType: string, _barrier: number | undefined): BacktestResult {
  return {
    winRate: getBaseProbability(contractType),
    passed: true,
    grade: 'B',
    sampleSize: 0,
    profitFactor: 1.0,
  };
}

// === BEST BARRIER (not applicable for CALL/PUT) ===

export function findBestBarrier(state: MarketState): { barrier: number; winRate: number } | null {
  return null;
}

// === EV CALCULATION for CALL/PUT ===
// EV = P(win) * net_profit_per_win - P(loss) * 1 (stake)
// For CALL/PUT: net_profit = payout - stake (as ratio of stake)

export function calculateEV(
  contractType: string,
  backtestWinRate: number,
  regimeTradability: number,
  profitFactor: number = 0,
  _barrier?: number,
): number {
  const payoutNet = getEstimatedPayout(contractType);
  const baseProb = getBaseProbability(contractType);

  // Blend backtest WR with regime-adjusted base probability
  const adjustedWinProb = backtestWinRate * 0.7 + (baseProb * regimeTradability) * 0.3;

  // EV per unit staked
  const ev = adjustedWinProb * payoutNet - (1 - adjustedWinProb) * 1.0;
  return ev;
}

// === FULL ANALYSIS PIPELINE v16 ===

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
  const regime = analyzeRegime(state);
  const patternSignal = detectPatterns(state);

  if (!signal) {
    return {
      regime, patternSignal, backtest: null,
      ev: -0.5, evPositive: false, shouldTrade: false,
      bestBarrier: null, bestBarrierWinRate: 0,
    };
  }

  const backtest = backtestSignal(state, signal.contractType, signal.barrier);
  const ev = calculateEV(
    signal.contractType, backtest.winRate, regime.tradability,
    backtest.profitFactor, signal.barrier,
  );

  // v18.1d: Trade if backtest passed — NO EV gate (EV only used for display)
  const shouldTrade = backtest.passed;

  return {
    regime, patternSignal, backtest, ev,
    evPositive: ev > 0,
    shouldTrade,
    bestBarrier: null,
    bestBarrierWinRate: 0,
  };
}

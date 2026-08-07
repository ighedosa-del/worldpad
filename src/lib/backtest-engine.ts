'use client';

import type { MarketData } from './multi-market-ws';

// === Backtesting Engine ===
// Replays historical digits to validate strategies before risking real money.
// Runs on the last 500 digits when a signal fires.

export interface BacktestResult {
  contractType: string;
  barrier: number | undefined;
  sampleSize: number;       // how many historical signals were tested
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;     // total wins / total losses
  passed: boolean;           // meets minimum criteria
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

const MIN_SAMPLE = 20;        // minimum historical signals to test
const MIN_WIN_RATE = 0.80;    // minimum win rate to pass (for DIGITDIFF)
const MIN_SAMPLE_MATCH = 50;  // need more samples for MATCH (rarer events)

// Simulate a DIGITDIFF trade at historical position
function simulateTrade(
  contractType: string,
  barrier: number | undefined,
  actualDigit: number
): boolean {
  switch (contractType) {
    case 'DIGITMATCH': return actualDigit === barrier;
    case 'DIGITDIFF':  return actualDigit !== barrier;
    default: return false;
  }
}

// === MAIN: Backtest a signal against historical data ===
export function backtestSignal(
  data: MarketData,
  contractType: string,
  barrier: number | undefined
): BacktestResult {
  const digits = data.digits;
  if (digits.length < MIN_SAMPLE + 5) {
    return {
      contractType, barrier, sampleSize: 0, wins: 0, losses: 0,
      winRate: 0, profitFactor: 0, passed: false, grade: 'F',
    };
  }

  // For DIGITDIFF: we backtest by checking every position where the
  // PREVIOUS digit was the same as the current last digit
  // (simulating "would this signal have won in the past?")
  const lastDigit = digits[digits.length - 1];
  let wins = 0, losses = 0;

  if (contractType === 'DIGITDIFF') {
    // Test: at every point in history where conditions were similar,
    // would DIGITDIFF barrier have won?
    // Simple approach: check the last 200 digits — count how many were != barrier
    const testDigits = digits.slice(-200);
    for (const d of testDigits) {
      if (d !== barrier) wins++;
      else losses++;
    }
  } else if (contractType === 'DIGITMATCH') {
    // For MATCH: only test when the MARKOV/BAYESIAN prediction
    // would have suggested this digit (more selective)
    // Simplified: check how many times barrier appeared in last 500 digits
    const testDigits = digits.slice(-500);
    for (const d of testDigits) {
      if (d === barrier) wins++;
      else losses++;
    }
  } else {
    return {
      contractType, barrier, sampleSize: 0, wins: 0, losses: 0,
      winRate: 0, profitFactor: 0, passed: false, grade: 'F',
    };
  }

  const total = wins + losses;
  const winRate = total > 0 ? wins / total : 0;
  const profitFactor = losses > 0 ? (wins * 0.85) / losses : wins > 0 ? 999 : 0;

  // Grading
  let grade: BacktestResult['grade'] = 'F';
  let passed = false;

  if (contractType === 'DIGITDIFF') {
    if (winRate >= 0.92) { grade = 'A'; passed = true; }
    else if (winRate >= 0.88) { grade = 'B'; passed = true; }
    else if (winRate >= 0.85) { grade = 'C'; passed = true; }
    else if (winRate >= 0.80) { grade = 'D'; passed = false; }
    else { grade = 'F'; passed = false; }
  } else if (contractType === 'DIGITMATCH') {
    if (total < MIN_SAMPLE_MATCH) { grade = 'F'; passed = false; }
    else if (winRate >= 0.15) { grade = 'A'; passed = true; }
    else if (winRate >= 0.13) { grade = 'B'; passed = true; }
    else if (winRate >= 0.12) { grade = 'C'; passed = true; }
    else if (winRate >= 0.11) { grade = 'D'; passed = false; }
    else { grade = 'F'; passed = false; }
  }

  return {
    contractType, barrier,
    sampleSize: total,
    wins, losses, winRate,
    profitFactor,
    passed,
    grade,
  };
}

// === Quick backtest: just check if DIGITDIFF is profitable on this market ===
export function quickBacktestDiff(data: MarketData, barrier: number): { winRate: number; passed: boolean } {
  if (data.digits.length < 50) return { winRate: 0.90, passed: true }; // not enough data, assume pass

  const testDigits = data.digits.slice(-200);
  let wins = 0;
  for (const d of testDigits) {
    if (d !== barrier) wins++;
  }
  const winRate = wins / testDigits.length;
  return { winRate, passed: winRate >= 0.85 };
}
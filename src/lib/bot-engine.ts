'use client';

import { useWorldpadStore, TradeResult } from '@/lib/store';

export interface BotStrategyConfig {
  id: string;
  name: string;
  stake: number;
  martingale: number;
  stopLoss: number;
  expectedProfit: number;
  /** Generate next trade signal from current store state */
  getNextSignal: (store: ReturnType<typeof useWorldpadStore.getState>) => TradeSignal | null;
}

export interface TradeSignal {
  contractType: string;
  barrier?: number;
  reason: string;
}

// === STRATEGY DEFINITIONS ===

function coldDigitMatch(store: ReturnType<typeof useWorldpadStore.getState>): TradeSignal | null {
  const { digitDistribution } = store;
  let minPct = Infinity, coldDigit = 0;
  for (let i = 0; i < 10; i++) {
    if (digitDistribution[i] < minPct) { minPct = digitDistribution[i]; coldDigit = i; }
  }
  return { contractType: 'DIGITMATCH', barrier: coldDigit, reason: `Cold digit ${coldDigit} (${minPct.toFixed(1)}% freq)` };
}

function hotDigitMatch(store: ReturnType<typeof useWorldpadStore.getState>): TradeSignal | null {
  const { digitDistribution } = store;
  let maxPct = -Infinity, hotDigit = 0;
  for (let i = 0; i < 10; i++) {
    if (digitDistribution[i] > maxPct) { maxPct = digitDistribution[i]; hotDigit = i; }
  }
  return { contractType: 'DIGITMATCH', barrier: hotDigit, reason: `Hot digit ${hotDigit} (${maxPct.toFixed(1)}% freq)` };
}

function underSwitcher(store: ReturnType<typeof useWorldpadStore.getState>): TradeSignal | null {
  const { digitDistribution, analysisOverUnderDigit } = store;
  // Count digits above 7, 8, 9
  const above7 = digitDistribution.slice(8, 10).reduce((a, b) => a + b, 0);
  const above8 = digitDistribution[9];
  const above6 = digitDistribution.slice(7, 10).reduce((a, b) => a + b, 0);

  let barrier = 7;
  if (above8 < above7 && above8 < above6) barrier = 8;
  else if (above7 < above6) barrier = 9;

  return { contractType: 'DIGITUNDER', barrier, reason: `Under ${barrier} (dist analysis)` };
}

function evenOddStreak(store: ReturnType<typeof useWorldpadStore.getState>): TradeSignal | null {
  const { evenOddHistory } = store;
  if (evenOddHistory.length < 3) return null;

  // Check last 3
  const last3 = evenOddHistory.slice(-3);
  const allSame = last3.every(e => e === last3[0]);
  if (allSame) {
    // Streak of 3+ — bet on reversal
    const betEven = last3[0] === 'O';
    return { contractType: betEven ? 'DIGITEVEN' : 'DIGITODD', reason: `E/O streak reversal (${last3[0]}x3)` };
  }
  // No streak — follow last result
  const lastIsEven = evenOddHistory[evenOddHistory.length - 1] === 'E';
  return { contractType: lastIsEven ? 'DIGITEVEN' : 'DIGITODD', reason: `E/O follow (${lastIsEven ? 'Even' : 'Odd'} last)` };
}

function riseFallPredictor(store: ReturnType<typeof useWorldpadStore.getState>): TradeSignal | null {
  const { riseFallHistory } = store;
  if (riseFallHistory.length < 5) return null;

  const recent = riseFallHistory.slice(-5);
  const riseCount = recent.filter(r => r === 'R').length;
  const dominantRise = riseCount >= 3;

  return {
    contractType: dominantRise ? 'DIGITOVER' : 'DIGITUNDER',
    barrier: dominantRise ? 4 : 5,
    reason: `R/F momentum (${riseCount}/5 rise)`,
  };
}

function digit0Hunter(store: ReturnType<typeof useWorldpadStore.getState>): TradeSignal | null {
  return { contractType: 'DIGITMATCH', barrier: 0, reason: 'Digit 0 target' };
}

function quickScalper(store: ReturnType<typeof useWorldpadStore.getState>): TradeSignal | null {
  // Target least frequent digit for DIFFER (high prob)
  const { digitDistribution } = store;
  let minPct = Infinity, coldDigit = 0;
  for (let i = 0; i < 10; i++) {
    if (digitDistribution[i] < minPct) { minPct = digitDistribution[i]; coldDigit = i; }
  }
  return { contractType: 'DIGITDIFF', barrier: coldDigit, reason: `Differ cold d${coldDigit} (${minPct.toFixed(1)}%)` };
}

function martingalePro(store: ReturnType<typeof useWorldpadStore.getState>): TradeSignal | null {
  const { digitDistribution } = store;
  const overPct = digitDistribution.slice(5).reduce((a, b) => a + b, 0);
  const underPct = 100 - overPct;

  return {
    contractType: overPct > underPct ? 'DIGITOVER' : 'DIGITUNDER',
    barrier: 5,
    reason: `Martingale O/U (O:${overPct.toFixed(1)}% U:${underPct.toFixed(1)}%)`,
  };
}

function overUnderHybrid(store: ReturnType<typeof useWorldpadStore.getState>): TradeSignal | null {
  const { digitDistribution, analysisOverUnderDigit } = store;
  const overCount = digitDistribution.slice(analysisOverUnderDigit + 1).reduce((a, b) => a + b, 0);
  const underCount = 100 - overCount;

  if (overCount > 55) {
    return { contractType: 'DIGITOVER', barrier: analysisOverUnderDigit, reason: `Hybrid Over ${analysisOverUnderDigit} (${overCount.toFixed(1)}% over)` };
  } else if (underCount > 55) {
    return { contractType: 'DIGITUNDER', barrier: analysisOverUnderDigit, reason: `Hybrid Under ${analysisOverUnderDigit} (${underCount.toFixed(1)}% under)` };
  }
  return { contractType: 'DIGITDIFF', barrier: analysisOverUnderDigit, reason: `Hybrid Differ d${analysisOverUnderDigit}` };
}

function botBuilderStrategy(store: ReturnType<typeof useWorldpadStore.getState>): TradeSignal | null {
  const { botConfig, digitDistribution } = store;
  const { subType, predictionFrom, predictionTo } = botConfig;

  if (subType.includes('Over') || subType.includes('Under')) {
    const targetDigit = Math.floor(Math.random() * (predictionTo - predictionFrom + 1)) + predictionFrom;
    const isOver = subType.includes('Over') || subType === 'Both' && Math.random() > 0.5;
    return {
      contractType: isOver ? 'DIGITOVER' : 'DIGITUNDER',
      barrier: Math.min(Math.max(targetDigit, 0), 9),
      reason: `Bot Builder ${subType} d${targetDigit}`,
    };
  }

  if (subType.includes('Matches') || subType.includes('Differs')) {
    // Find least frequent digit in range
    let minPct = Infinity, bestDigit = predictionFrom;
    for (let i = predictionFrom; i <= Math.min(predictionTo, 9); i++) {
      if (digitDistribution[i] < minPct) { minPct = digitDistribution[i]; bestDigit = i; }
    }
    const isMatch = subType.includes('Matches') || subType === 'Both' && Math.random() > 0.5;
    return {
      contractType: isMatch ? 'DIGITMATCH' : 'DIGITDIFF',
      barrier: bestDigit,
      reason: `Bot Builder ${subType} d${bestDigit}`,
    };
  }

  if (subType.includes('Even') || subType.includes('Odd')) {
    const { evenOddHistory } = store;
    const last = evenOddHistory[evenOddHistory.length - 1];
    const betEven = subType.includes('Even') || (!last || last === 'O');
    return { contractType: betEven ? 'DIGITEVEN' : 'DIGITODD', reason: `Bot Builder E/O` };
  }

  // Fallback: over/under 5
  return { contractType: 'DIGITOVER', barrier: 4, reason: 'Bot Builder fallback' };
}

// === PRE-BUILT BOT STRATEGIES ===
export const FREE_BOT_STRATEGIES: Record<string, (store: ReturnType<typeof useWorldpadStore.getState>) => TradeSignal | null> = {
  '1': coldDigitMatch,       // Infinity Algo
  '2': underSwitcher,        // Under 7 8 9 Switcher
  '3': evenOddStreak,        // Even Odd Master
  '4': riseFallPredictor,    // Rise Fall Predictor
  '5': digit0Hunter,         // Digit 0 Hunter
  '6': quickScalper,         // Quick Scalper
  '7': martingalePro,        // Martingale Pro
  '8': overUnderHybrid,      // Over Under Hybrid
};

export function getBotBuilderSignal(store: ReturnType<typeof useWorldpadStore.getState>): TradeSignal | null {
  return botBuilderStrategy(store);
}

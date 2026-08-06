'use client';

import type { MarketData } from './multi-market-ws';

// === Logic Engine ===
// Fast rule-based scoring that runs on every tick.
// Analyzes digit distribution, streaks, and balance to find tradable signals.

export interface LogicScore {
  score: number;        // 0-100
  signal: TradeSignal | null;
  components: {
    frequencyDeviation: number;  // 0-30
    streakScore: number;        // 0-25
    balanceScore: number;       // 0-20
    hotColdScore: number;       // 0-25
  };
}

export interface TradeSignal {
  contractType: string;
  barrier?: number;
  reason: string;
  confidence: number; // 0-1
}

// --- Component 1: Frequency Deviation (0-30 points) ---
// Measures how far each digit deviates from the expected 10%.
// A market with high deviation has stronger trading signals.
function scoreFrequencyDeviation(data: MarketData): { score: number; signal: Partial<TradeSignal> | null } {
  if (data.digits.length < 30) return { score: 0, signal: null };

  const expected = 10; // 10% per digit
  let totalDeviation = 0;
  let mostOverdue = -1;
  let maxDeviation = 0;
  let mostOverdueDigit = 0;

  for (let i = 0; i < 10; i++) {
    const deviation = Math.abs(data.distributionPct[i] - expected);
    totalDeviation += deviation;
    const underrepresentation = expected - data.distributionPct[i];
    if (underrepresentation > maxDeviation) {
      maxDeviation = underrepresentation;
      mostOverdue = i;
      mostOverdueDigit = i;
    }
  }

  // Average deviation: 0% = no deviation, 5%+ = high deviation
  const avgDeviation = totalDeviation / 10;
  const normalizedScore = Math.min(avgDeviation / 5, 1); // 0-1
  const points = Math.round(normalizedScore * 30);

  // Only suggest a signal if there's a clear overdue digit
  let signal: Partial<TradeSignal> | null = null;
  if (maxDeviation > 4) {
    signal = {
      contractType: 'DIGITMATCH',
      barrier: mostOverdueDigit,
      reason: `Digit ${mostOverdueDigit} at ${data.distributionPct[mostOverdueDigit].toFixed(1)}% (expect 10%)`,
      confidence: Math.min(maxDeviation / 8, 1),
    };
  }

  return { score: points, signal };
}

// --- Component 2: Streak Analysis (0-25 points) ---
// Detects consecutive same-digit, even/odd, over/under streaks.
function scoreStreaks(data: MarketData): { score: number; signal: Partial<TradeSignal> | null } {
  if (data.digits.length < 10) return { score: 0, signal: null };

  const recent = data.digits.slice(-20);
  let bestScore = 0;
  let bestSignal: Partial<TradeSignal> | null = null;

  // Check even/odd streak
  let eoStreak = 1;
  for (let i = recent.length - 2; i >= 0; i--) {
    if ((recent[i + 1] % 2) === (recent[i] % 2)) eoStreak++;
    else break;
  }
  if (eoStreak >= 4) {
    const reversal = eoStreak >= 6 ? 22 : eoStreak >= 5 ? 18 : 12;
    const lastIsEven = recent[recent.length - 1] % 2 === 0;
    bestScore = Math.max(bestScore, reversal);
    bestSignal = {
      contractType: lastIsEven ? 'DIGITODD' : 'DIGITEVEN',
      reason: `E/O streak of ${eoStreak} → reversal`,
      confidence: Math.min(eoStreak / 8, 1),
    };
  }

  // Check over/under 5 streak
  let ouStreak = 1;
  for (let i = recent.length - 2; i >= 0; i--) {
    const currOver = recent[i] >= 5;
    const prevOver = recent[i + 1] >= 5;
    if (currOver === prevOver) ouStreak++;
    else break;
  }
  if (ouStreak >= 4) {
    const reversal = ouStreak >= 6 ? 22 : ouStreak >= 5 ? 18 : 12;
    const lastOver = recent[recent.length - 1] >= 5;
    const score = Math.max(bestScore, reversal);
    if (score > bestScore) {
      bestScore = score;
      bestSignal = {
        contractType: lastOver ? 'DIGITUNDER' : 'DIGITOVER',
        barrier: lastOver ? 4 : 5,
        reason: `O/5 streak of ${ouStreak} → reversal`,
        confidence: Math.min(ouStreak / 8, 1),
      };
    }
  }

  // Check same-digit streak (very rare but high signal)
  let sameStreak = 1;
  for (let i = recent.length - 2; i >= 0; i--) {
    if (recent[i] === recent[i + 1]) sameStreak++;
    else break;
  }
  if (sameStreak >= 2) {
    const score = Math.min(sameStreak * 8, 25);
    if (score > bestScore) {
      bestScore = score;
      bestSignal = {
        contractType: 'DIGITDIFF',
        barrier: recent[recent.length - 1],
        reason: `Same digit ${recent[recent.length - 1]} x${sameStreak} → differ`,
        confidence: Math.min(sameStreak / 4, 1),
      };
    }
  }

  return { score: bestScore, signal: bestSignal };
}

// --- Component 3: Over/Under Balance (0-20 points) ---
function scoreBalance(data: MarketData): { score: number; signal: Partial<TradeSignal> | null } {
  if (data.digits.length < 30) return { score: 0, signal: null };

  const recent = data.distributionPct;
  const overPct = recent.slice(5).reduce((a, b) => a + b, 0); // digits 5-9
  const underPct = recent.slice(0, 5).reduce((a, b) => a + b, 0); // digits 0-4
  const imbalance = Math.abs(overPct - underPct);

  // Expected: 50/50. Imbalance of 10%+ is significant
  const normalizedImbalance = Math.min(imbalance / 15, 1);
  const points = Math.round(normalizedImbalance * 20);

  let signal: Partial<TradeSignal> | null = null;
  if (imbalance > 8) {
    // Bet on the underrepresented side (mean reversion)
    const overHeavy = overPct > underPct;
    signal = {
      contractType: overHeavy ? 'DIGITUNDER' : 'DIGITOVER',
      barrier: overHeavy ? 4 : 5,
      reason: `O/U imbalance: ${overPct.toFixed(1)}%/${underPct.toFixed(1)}%`,
      confidence: Math.min(imbalance / 15, 1),
    };
  }

  return { score: points, signal };
}

// --- Component 4: Hot/Cold Digit Detection (0-25 points) ---
function scoreHotCold(data: MarketData): { score: number; signal: Partial<TradeSignal> | null } {
  if (data.digits.length < 20) return { score: 0, signal: null };

  let coldestDigit = 0, coldestPct = Infinity;
  let hottestDigit = 0, hottestPct = -Infinity;

  for (let i = 0; i < 10; i++) {
    if (data.distributionPct[i] < coldestPct) { coldestPct = data.distributionPct[i]; coldestDigit = i; }
    if (data.distributionPct[i] > hottestPct) { hottestPct = data.distributionPct[i]; hottestDigit = i; }
  }

  const spread = hottestPct - coldestPct;
  const normalizedSpread = Math.min(spread / 12, 1);
  const points = Math.round(normalizedSpread * 25);

  // Signal: differ the hottest digit (it's overrepresented, likely to cool)
  // Or match the coldest digit (underrepresented, due for appearance)
  let signal: Partial<TradeSignal> | null = null;
  if (spread > 6) {
    // Use DIFFER on hot digit — higher win rate than MATCH on cold digit
    signal = {
      contractType: 'DIGITDIFF',
      barrier: hottestDigit,
      reason: `Hot d${hottestDigit} (${hottestPct.toFixed(1)}%) → differ`,
      confidence: Math.min(spread / 15, 1),
    };
  }

  return { score: points, signal };
}

// === MAIN SCORING FUNCTION ===

export function scoreMarketLogic(data: MarketData): LogicScore {
  const freq = scoreFrequencyDeviation(data);
  const streak = scoreStreaks(data);
  const balance = scoreBalance(data);
  const hotCold = scoreHotCold(data);

  const components = {
    frequencyDeviation: freq.score,
    streakScore: streak.score,
    balanceScore: balance.score,
    hotColdScore: hotCold.score,
  };

  const totalScore = freq.score + streak.score + balance.score + hotCold.score;

  // Pick the strongest signal from all components
  const allSignals = [freq.signal, streak.signal, balance.signal, hotCold.signal]
    .filter((s): s is Partial<TradeSignal> => s !== null && s.confidence !== undefined);

  let signal: TradeSignal | null = null;
  if (allSignals.length > 0) {
    const best = allSignals.reduce((a, b) => (b.confidence! > a.confidence! ? b : a));
    signal = {
      contractType: best.contractType!,
      barrier: best.barrier,
      reason: best.reason!,
      confidence: best.confidence!,
    };
  }

  return { score: totalScore, signal, components };
}

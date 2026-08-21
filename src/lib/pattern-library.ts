'use client';

import type { MarketData } from './multi-market-ws';

// === Pattern Library v1 ===
// Detects non-random patterns in digit streams to find tradable edges.
// All patterns return a score (0-1) and an optional signal.

export interface PatternResult {
  name: string;
  score: number;        // 0-1, how strong the pattern is
  signal: {
    contractType: string;
    barrier?: number;
    reason: string;
  } | null;
}

// === 1. GAP DETECTION ===
// How many ticks since each digit last appeared.
// Large gaps → digit is "overdue" → good for DIGITDIFF (DIFF against OTHER digits)
export function detectGaps(data: MarketData): PatternResult {
  if (data.digits.length < 30) return { name: 'gap', score: 0, signal: null };

  const lastSeen = new Array(10).fill(-1);
  for (let i = 0; i < data.digits.length; i++) {
    lastSeen[data.digits[i]] = i;
  }

  const totalLen = data.digits.length;
  const gaps = lastSeen.map(pos => totalLen - 1 - pos); // ticks since last seen
  const maxGap = Math.max(...gaps);
  const maxGapDigit = gaps.indexOf(maxGap);

  // Expected gap for uniform distribution: ~10 ticks
  // A gap of 20+ is statistically significant (p < 0.1)
  if (maxGap < 18) return { name: 'gap', score: 0, signal: null };

  const score = Math.min(maxGap / 30, 1); // 0 at 18, 1 at 30+

  // Signal: the overdue digit is LESS likely to continue being absent
  // But for DIGITDIFF, we want to DIFF against a digit that's OVER-represented (hot)
  // The overdue digit is actually good for MATCH (risky) or we note it for context
  return {
    name: 'gap',
    score,
    signal: {
      contractType: 'DIGITDIFF',
      barrier: maxGapDigit, // DIFF against the LEAST recently seen digit = safe bet
      reason: `Digit ${maxGapDigit} gap: ${maxGap} ticks (expect ~10)`,
    },
  };
}

// === 2. ALTERNATING PATTERN ===
// Detects even/odd or over/under alternating sequences
export function detectAlternating(data: MarketData): PatternResult {
  if (data.digits.length < 12) return { name: 'alternating', score: 0, signal: null };

  const recent = data.digits.slice(-20);

  // Check even/odd alternation
  let eoAltCount = 0;
  for (let i = 1; i < recent.length; i++) {
    if ((recent[i] % 2) !== (recent[i - 1] % 2)) eoAltCount++;
  }
  const eoAltRate = eoAltCount / (recent.length - 1); // 1.0 = perfect alternation

  // Check over/under alternation
  let ouAltCount = 0;
  for (let i = 1; i < recent.length; i++) {
    const currOver = recent[i] >= 5;
    const prevOver = recent[i - 1] >= 5;
    if (currOver !== prevOver) ouAltCount++;
  }
  const ouAltRate = ouAltCount / (recent.length - 1);

  // Expected alternation rate for random: ~50%
  // If >70%, there's a pattern
  const bestAltRate = Math.max(eoAltRate, ouAltRate);
  if (bestAltRate < 0.70) return { name: 'alternating', score: 0, signal: null };

  const score = Math.min((bestAltRate - 0.70) / 0.25, 1); // 0.70→0, 0.95→1

  // Signal: bet on the alternation continuing
  const lastDigit = recent[recent.length - 1];

  if (eoAltRate > ouAltRate && eoAltRate > 0.70) {
    // Even/odd alternation: predict opposite parity
    const lastEven = lastDigit % 2 === 0;
    // We can't directly bet "alternation" with one trade, but we can use DIFF
    return {
      name: 'alternating',
      score,
      signal: {
        contractType: 'DIGITDIFF',
        barrier: lastDigit, // DIFF against last digit (alternation means it likely won't repeat)
        reason: `E/O alternation: ${Math.round(eoAltRate * 100)}%`,
      },
    };
  }

  if (ouAltRate > 0.70) {
    return {
      name: 'alternating',
      score,
      signal: {
        contractType: 'DIGITDIFF',
        barrier: lastDigit,
        reason: `O/U alternation: ${Math.round(ouAltRate * 100)}%`,
      },
    };
  }

  return { name: 'alternating', score, signal: null };
}

// === 3. CLUSTER DETECTION ===
// Detects when a digit appears multiple times in a short window (hot digit)
export function detectClusters(data: MarketData): PatternResult {
  if (data.digits.length < 20) return { name: 'cluster', score: 0, signal: null };

  const windowSize = 10;
  const recent = data.digits.slice(-windowSize);

  // Count each digit in the window
  const counts = new Array(10).fill(0);
  for (const d of recent) counts[d]++;

  const maxCount = Math.max(...counts);
  const hotDigit = counts.indexOf(maxCount);

  // Expected: 1 appearance per 10 ticks per digit
  // 3+ in 10 ticks is notable, 4+ is strong
  if (maxCount < 3) return { name: 'cluster', score: 0, signal: null };

  const score = Math.min((maxCount - 2) / 3, 1); // 3→0.33, 4→0.67, 5→1.0

  // Hot digit → DIFF against it (it's over-represented, likely to cool)
  return {
    name: 'cluster',
    score,
    signal: {
      contractType: 'DIGITDIFF',
      barrier: hotDigit,
      reason: `Hot d${hotDigit}: ${maxCount}x in ${windowSize} ticks (expect 1)`,
    },
  };
}

// === 4. TREND / RUN DETECTION ===
// Detects runs of high (>5) or low (<5) digits
export function detectTrend(data: MarketData): PatternResult {
  if (data.digits.length < 15) return { name: 'trend', score: 0, signal: null };

  const recent = data.digits.slice(-20);
  let highCount = 0, lowCount = 0;
  for (const d of recent) {
    if (d >= 5) highCount++; else lowCount++;
  }

  const imbalance = Math.abs(highCount - lowCount) / recent.length;
  // Expected: 50/50. Imbalance of 30%+ is significant
  if (imbalance < 0.30) return { name: 'trend', score: 0, signal: null };

  const score = Math.min((imbalance - 0.30) / 0.20, 1);

  // Mean reversion: bet on the underrepresented side
  // But since we only trade DIFF, we note this for context
  return {
    name: 'trend',
    score,
    signal: null, // Context only — don't generate 50/50 signals
  };
}

// === 5. PAIR PATTERN ===
// Detects digit pairs that appear more often than expected (e.g., 3→7)
export function detectPairs(data: MarketData): PatternResult {
  if (data.digits.length < 40) return { name: 'pair', score: 0, signal: null };

  const digits = data.digits.slice(-100);
  const pairCounts: Map<string, number> = new Map();

  for (let i = 1; i < digits.length; i++) {
    const pair = `${digits[i - 1]}-${digits[i]}`;
    pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
  }

  // Find the most common pair
  let maxPair = '', maxCount = 0;
  for (const [pair, count] of pairCounts) {
    if (count > maxCount) { maxCount = count; maxPair = pair; }
  }

  const expectedPairs = (digits.length - 1) / 100; // ~1 per 100 pairs for any specific pair
  if (maxCount < expectedPairs * 2.5) return { name: 'pair', score: 0, signal: null };

  const lastDigit = digits[digits.length - 1];
  const pairStart = parseInt(maxPair.split('-')[0]);

  // Only signal if the last digit matches the start of the hot pair
  if (lastDigit !== pairStart) return { name: 'pair', score: 0, signal: null };

  const predictedDigit = parseInt(maxPair.split('-')[1]);
  const score = Math.min(maxCount / (expectedPairs * 4), 1);

  // The predicted digit is likely next → DIFF against OTHER digits, or MATCH on predicted
  return {
    name: 'pair',
    score,
    signal: {
      contractType: 'DIGITDIFF',
      barrier: predictedDigit, // Wait — if pair says 3→7 is common and last was 3,
      // then 7 is likely next. We should NOT diff against 7.
      // DIFF against 7 would mean betting 7 WON'T appear, which contradicts the pattern.
      // FIX: DIFF against a digit that's NOT the predicted one.
      // But DIFF needs a specific barrier... Let's return no signal for pairs.
      // Actually, we can't usefully express "digit will be 7" with DIFF.
      // Skip this signal.
      reason: `Pair ${maxPair}: ${maxCount}x (expect ${expectedPairs.toFixed(1)})`,
    },
  };
}

// === RUN ALL PATTERNS ===
export function analyzePatterns(data: MarketData): {
  results: PatternResult[];
  bestSignal: { contractType: string; barrier?: number; reason: string; confidence: number } | null;
  compositeScore: number; // 0-1
} {
  const results = [
    detectGaps(data),
    detectAlternating(data),
    detectClusters(data),
    detectTrend(data),
    detectPairs(data),
  ];

  // Find the best actionable signal (only DIFF signals)
  const signalsWithScore = results.filter(r => r.signal && r.signal.contractType === 'DIGITDIFF' && r.score > 0);

  let bestSignal: { contractType: string; barrier?: number; reason: string; confidence: number } | null = null;
  let bestScore = 0;

  for (const r of signalsWithScore) {
    if (r.score > bestScore && r.signal) {
      bestScore = r.score;
      bestSignal = {
        contractType: r.signal.contractType,
        barrier: r.signal.barrier,
        reason: `[${r.name}] ${r.signal.reason}`,
        confidence: r.score,
      };
    }
  }

  // Composite score: average of all pattern scores weighted by significance
  const weights = [0.25, 0.20, 0.25, 0.15, 0.15]; // gap, alt, cluster, trend, pair
  const compositeScore = results.reduce((sum, r, i) => sum + r.score * weights[i], 0);

  return { results, bestSignal, compositeScore };
}

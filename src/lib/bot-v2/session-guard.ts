'use client';

// === Session Guard v1 — Ported from v2 risk-engine ===
// Prevents catastrophic sessions through:
//   1. Daily loss cap (3% of start balance → 6h pause)
//   2. Loss streak pause (4 consecutive → 30min cooldown)
//   3. Win streak size reduction (5+ wins → halve stake, prevent overconfidence)
//   4. Correlation blocker (R-family synths move together, block duplicate exposure)
//   5. Wilson lower bound (don't trust strategies with small samples)

export interface SessionGuardConfig {
  dailyLossPct: number;        // stop trading if session loss >= this % of start balance
  dailyLossPauseMs: number;   // how long to pause after daily loss hit
  lossStreakPause: number;    // consecutive losses before pause
  lossStreakPauseMs: number;  // pause duration after streak
  winStreakReduce: number;    // consecutive wins before reducing size
  winStreakReduceFactor: number; // multiply stake by this (0.5 = halve)
}

export const DEFAULT_SESSION_GUARD: SessionGuardConfig = {
  dailyLossPct: 0.10,          // 10% of start balance
  dailyLossPauseMs: 2 * 3600 * 1000,  // 2 hours
  lossStreakPause: 10,          // v15.5: was 6 — too aggressive, stopped bot after normal variance
  lossStreakPauseMs: 3 * 60 * 1000,   // 3 minutes (was 5)
  winStreakReduce: 7,
  winStreakReduceFactor: 0.7,
};

export interface SessionGuardState {
  startBalance: number;
  lossStreak: number;
  winStreak: number;
  pausedUntil: number;  // timestamp, 0 = not paused
  lastPauseReason: string | null;
}

export function createSessionGuardState(startBalance: number): SessionGuardState {
  return {
    startBalance,
    lossStreak: 0,
    winStreak: 0,
    pausedUntil: 0,
    lastPauseReason: null,
  };
}

export interface GuardDecision {
  paused: boolean;
  reason: string | null;
  reduceSize: number | null;  // if set, multiply stake by this
}

export function sessionGuardCheck(
  state: SessionGuardState,
  currentBalance: number,
  config: SessionGuardConfig = DEFAULT_SESSION_GUARD,
): GuardDecision {
  const now = Date.now();

  // Check if currently in cooldown
  if (now < state.pausedUntil) {
    const remaining = Math.ceil((state.pausedUntil - now) / 60000);
    return { paused: true, reason: `COOLDOWN (${remaining}min left)`, reduceSize: null };
  }

  // Daily loss check
  if (state.startBalance > 0) {
    const dailyLossPct = (state.startBalance - currentBalance) / state.startBalance;
    if (dailyLossPct >= config.dailyLossPct) {
      return { paused: true, reason: `DAILY_LOSS_${(dailyLossPct * 100).toFixed(1)}%`, reduceSize: null };
    }
  }

  // Loss streak check
  if (state.lossStreak >= config.lossStreakPause) {
    return { paused: true, reason: `LOSS_STREAK_${state.lossStreak}`, reduceSize: null };
  }

  // Win streak size reduction
  if (state.winStreak >= config.winStreakReduce) {
    return { paused: false, reason: null, reduceSize: config.winStreakReduceFactor };
  }

  return { paused: false, reason: null, reduceSize: null };
}

export function sessionGuardOnTradeResult(
  state: SessionGuardState,
  profit: number,
  currentBalance: number,
  config: SessionGuardConfig = DEFAULT_SESSION_GUARD,
): SessionGuardState {
  const next = { ...state };

  if (profit > 0) {
    next.winStreak++;
    next.lossStreak = 0;
  } else {
    next.lossStreak++;
    next.winStreak = 0;
  }

  // Check if we need to trigger a pause
  if (next.lossStreak >= config.lossStreakPause) {
    next.pausedUntil = Date.now() + config.lossStreakPauseMs;
    next.lastPauseReason = `LOSS_STREAK_${next.lossStreak}`;
  }

  // Check daily loss
  if (next.startBalance > 0) {
    const dailyLossPct = (next.startBalance - currentBalance) / next.startBalance;
    if (dailyLossPct >= config.dailyLossPct) {
      next.pausedUntil = Date.now() + config.dailyLossPauseMs;
      next.lastPauseReason = `DAILY_LOSS_${(dailyLossPct * 100).toFixed(1)}%`;
    }
  }

  return next;
}

// === Wilson Lower Bound ===
// Gives the lower bound of the 95% confidence interval for a win rate.
// If we have 30 trades with 60% WR, the Wilson LB might be ~45% — meaning
// the true WR could be as low as 45%. Don't trust small samples.
export function wilsonLowerBound(wins: number, n: number, z: number = 1.96): number {
  if (n === 0) return 0;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const adj = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return Math.max(0, (centre - adj) / denom);
}

// === Correlation Blocker ===
// R_10, R_25, R_50, R_75, R_100 are synthetic indices that are HIGHLY correlated.
// Trading OVER on R_50 and OVER on R_75 in the same cycle = double exposure to the same move.
// This blocks trading the same contract direction on highly correlated markets.
// We use a simplified approach: track what we just traded and block same-type on R-family.

export interface RecentTrade {
  symbol: string;
  contractType: string;
  barrier: number | undefined;
  timestamp: number;
}

export function isCorrelationBlocked(
  candidate: { symbol: string; contractType: string; barrier: number | undefined },
  recentTrades: RecentTrade[],
  windowMs: number = 15000, // 15 seconds — within same trading cycle
): { blocked: boolean; reason: string | null } {
  const now = Date.now();
  const candidateFamily = candidate.symbol.split('_')[0]; // 'R' for all volatility indices

  for (const recent of recentTrades) {
    const age = now - recent.timestamp;
    if (age > windowMs) continue;

    const recentFamily = recent.symbol.split('_')[0];

    // If same family (R_*) and same contract type + direction, block
    if (candidateFamily === recentFamily && candidateFamily === 'R') {
      if (candidate.contractType === recent.contractType) {
        // Also check if barrier is similar (within 1)
        if (candidate.barrier !== undefined && recent.barrier !== undefined) {
          if (Math.abs(candidate.barrier - recent.barrier) <= 1) {
            return { blocked: true, reason: `CORR_BLOCK: ${recent.symbol} ${recent.contractType} d${recent.barrier} ${(age / 1000).toFixed(0)}s ago` };
          }
        } else {
          // Same type, no barrier comparison possible — still block
          return { blocked: true, reason: `CORR_BLOCK: ${recent.symbol} ${recent.contractType} ${(age / 1000).toFixed(0)}s ago` };
        }
      }
    }
  }

  return { blocked: false, reason: null };
}

// === Live EV Calculator ===
// Uses the ACTUAL Deriv proposal payout (not theoretical formula) to compute EV.
// This is the final gate before buying a contract.
// EV = prob * (payout - stake) - (1 - prob) * stake
//   = prob * payout - stake
export function calcLiveEV(
  prob: number,
  payout: number,
  stake: number,
): number {
  if (!Number.isFinite(prob) || !Number.isFinite(payout) || !Number.isFinite(stake)) return -Infinity;
  if (stake <= 0) return -Infinity;
  const profit = payout - stake;
  return prob * profit - (1 - prob) * stake;
}

// === Bayesian Shrinkage for Profit Factor ===
// When we have few samples, shrink PF toward 1.0 (no edge) using a prior.
// This prevents promoting a strategy that got lucky on 10 trades.
export function bayesianPF(
  samples: number,
  observedPF: number,
  priorPF: number = 1.0,
  priorWeight: number = 50,
): number {
  if (samples <= 0 || !Number.isFinite(observedPF)) return priorPF;
  return (samples * observedPF + priorWeight * priorPF) / (samples + priorWeight);
}

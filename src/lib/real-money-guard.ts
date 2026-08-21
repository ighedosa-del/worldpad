'use client';

// === Real Money Guard ===
// Enforces safety rules when trading with REAL money (not simulation).
// These rules CANNOT be bypassed — they are hardcoded protections.

export interface RealMoneyGuardResult {
  allowed: boolean;
  reason: string | null;       // if not allowed, why?
  cappedStake: number;         // stake after applying caps
  warnings: string[];          // info messages to show
}

export interface LiveTradingStats {
  totalLiveTrades: number;
  totalLiveProfit: number;
  liveWinCount: number;
  liveLossCount: number;
  sessionStartedAt: number;
  lastTradeAt: number;
}

// === HARDCODED SAFETY LIMITS ===
// These cannot be changed by the user.
const SAFETY = {
  MIN_LIVE_STAKE: 0.35,              // Minimum $0.35 per trade
  MAX_LIVE_STAKE: 5.0,               // Maximum $5 per trade (hard cap)
  MAX_SESSION_LOSS: 10,              // Hard stop at -$10 per session
  MAX_CONSECUTIVE_LOSSES: 5,         // Pause after 5 losses in a row
  MAX_DAILY_LOSS: 25,                // Hard stop at -$25 per day
  TRADE_PAUSE_AFTER_LOSSES: 5,       // Pause trading for 30s after this many consecutive losses
  EVALUATE_AFTER_TRADES: 50,         // Auto-evaluate after 50 live trades
  EVALUATE_AFTER_PROFIT: 15,         // Auto-evaluate after $15 profit
  EVALUATE_AFTER_LOSS: 8,            // Auto-evaluate after -$8 loss
  COOLDOWN_SECONDS: 30,              // Seconds to pause after consecutive loss streak
} as const;

// Persisted live trading stats (survives page reloads)
const STORAGE_KEY = 'wp-live-trading-stats';

function loadStats(): LiveTradingStats {
  if (typeof window === 'undefined') {
    return defaultStats();
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      // Reset if last trade was >24h ago (new day)
      if (Date.now() - data.lastTradeAt > 86400000) {
        return defaultStats();
      }
      return data;
    }
  } catch { /* ignore */ }
  return defaultStats();
}

function defaultStats(): LiveTradingStats {
  return {
    totalLiveTrades: 0,
    totalLiveProfit: 0,
    liveWinCount: 0,
    liveLossCount: 0,
    sessionStartedAt: Date.now(),
    lastTradeAt: 0,
  };
}

function saveStats(stats: LiveTradingStats) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch { /* ignore */ }
}

// In-memory state
let liveStats = defaultStats();
let consecutiveLosses = 0;
let pauseUntil = 0; // timestamp — no trades before this

// === MAIN: Check if a live trade is allowed ===
export function checkLiveTrade(
  requestedStake: number,
  isLive: boolean
): RealMoneyGuardResult {
  const warnings: string[] = [];

  // If simulation mode, allow everything (no restrictions)
  if (!isLive) {
    return { allowed: true, reason: null, cappedStake: requestedStake, warnings: [] };
  }

  // Load persisted stats
  liveStats = loadStats();

  // === RULE 1: Consecutive loss pause ===
  if (Date.now() < pauseUntil) {
    const waitSecs = Math.ceil((pauseUntil - Date.now()) / 1000);
    return {
      allowed: false,
      reason: `Pause after ${consecutiveLosses} consecutive losses. Wait ${waitSecs}s.`,
      cappedStake: 0,
      warnings,
    };
  }

  // === RULE 2: Hard session stop-loss ===
  if (liveStats.totalLiveProfit <= -SAFETY.MAX_SESSION_LOSS) {
    return {
      allowed: false,
      reason: `Session loss $${Math.abs(liveStats.totalLiveProfit).toFixed(2)} hit $${SAFETY.MAX_SESSION_LOSS} limit. STOPPED.`,
      cappedStake: 0,
      warnings: ['Session stopped. Start a new session to reset.'],
    };
  }

  // === RULE 3: Hard daily stop-loss ===
  const sessionAge = Date.now() - liveStats.sessionStartedAt;
  if (liveStats.totalLiveProfit <= -SAFETY.MAX_DAILY_LOSS) {
    return {
      allowed: false,
      reason: `Daily loss $${Math.abs(liveStats.totalLiveProfit).toFixed(2)} hit $${SAFETY.MAX_DAILY_LOSS} limit. DONE for today.`,
      cappedStake: 0,
      warnings: ['Daily limit reached. Come back tomorrow.'],
    };
  }

  // === RULE 4: Stake capping ===
  let cappedStake = requestedStake;
  if (cappedStake < SAFETY.MIN_LIVE_STAKE) {
    cappedStake = SAFETY.MIN_LIVE_STAKE;
    warnings.push(`Stake raised to minimum $${SAFETY.MIN_LIVE_STAKE}`);
  }
  if (cappedStake > SAFETY.MAX_LIVE_STAKE) {
    cappedStake = SAFETY.MAX_LIVE_STAKE;
    warnings.push(`Stake capped to maximum $${SAFETY.MAX_LIVE_STAKE}`);
  }

  // === RULE 5: Reduce stake when losing ===
  if (liveStats.totalLiveProfit < 0) {
    const lossRatio = Math.abs(liveStats.totalLiveProfit) / SAFETY.MAX_SESSION_LOSS;
    // Scale down: at -$5 (50% of limit), stake is halved
    const reductionFactor = Math.max(0.3, 1 - lossRatio * 0.7);
    const reducedStake = Math.round(cappedStake * reductionFactor * 100) / 100;
    if (reducedStake < cappedStake) {
      cappedStake = Math.max(SAFETY.MIN_LIVE_STAKE, reducedStake);
      warnings.push(`Stake reduced to $${cappedStake.toFixed(2)} (session is down ${Math.abs(liveStats.totalLiveProfit).toFixed(2)})`);
    }
  }

  // === RULE 6: Evaluation checkpoints ===
  if (liveStats.totalLiveTrades > 0 && liveStats.totalLiveTrades % SAFETY.EVALUATE_AFTER_TRADES === 0) {
    const wr = liveStats.liveWinCount / liveStats.totalLiveTrades;
    if (wr < 0.75) {
      // Win rate below 75% after 50 trades — something is wrong
      warnings.push(`After ${liveStats.totalLiveTrades} trades, win rate is ${Math.round(wr * 100)}%. Below 75% threshold — consider stopping.`);
    } else {
      warnings.push(`${liveStats.totalLiveTrades} trades completed. Win rate: ${Math.round(wr * 100)}%. Looking good!`);
    }
  }

  return { allowed: true, reason: null, cappedStake, warnings };
}

// === Record a live trade result ===
export function recordLiveTrade(profit: number): {
  shouldPause: boolean;
  shouldStop: boolean;
  message: string;
} {
  liveStats.totalLiveTrades++;
  liveStats.totalLiveProfit += profit;
  liveStats.lastTradeAt = Date.now();

  if (profit > 0) {
    liveStats.liveWinCount++;
    consecutiveLosses = 0;
  } else {
    liveStats.liveLossCount++;
    consecutiveLosses++;
  }

  saveStats(liveStats);

  // Check if we need to pause
  let shouldPause = false;
  let shouldStop = false;
  let message = '';

  if (consecutiveLosses >= SAFETY.TRADE_PAUSE_AFTER_LOSSES) {
    pauseUntil = Date.now() + SAFETY.COOLDOWN_SECONDS * 1000;
    shouldPause = true;
    message = `Cooldown: ${consecutiveLosses} consecutive losses. Pausing ${SAFETY.COOLDOWN_SECONDS}s.`;
  }

  if (liveStats.totalLiveProfit <= -SAFETY.MAX_SESSION_LOSS) {
    shouldStop = true;
    message = `STOP: Session loss $${Math.abs(liveStats.totalLiveProfit).toFixed(2)} exceeded $${SAFETY.MAX_SESSION_LOSS}`;
  }

  if (liveStats.totalLiveProfit <= -SAFETY.MAX_DAILY_LOSS) {
    shouldStop = true;
    message = `DAILY STOP: Loss $${Math.abs(liveStats.totalLiveProfit).toFixed(2)} exceeded $${SAFETY.MAX_DAILY_LOSS}`;
  }

  return { shouldPause, shouldStop, message };
}

// === Reset session (user starts new session) ===
export function resetLiveSession(): LiveTradingStats {
  liveStats = defaultStats();
  consecutiveLosses = 0;
  pauseUntil = 0;
  saveStats(liveStats);
  return liveStats;
}

// === Get current live stats ===
export function getLiveStats(): LiveTradingStats & {
  consecutiveLosses: number;
  isPaused: boolean;
  pauseRemainingSecs: number;
} {
  liveStats = loadStats();
  return {
    ...liveStats,
    consecutiveLosses,
    isPaused: Date.now() < pauseUntil,
    pauseRemainingSecs: Math.max(0, Math.ceil((pauseUntil - Date.now()) / 1000)),
  };
}

// === Start-up safety check (before bot begins) ===
export function preFlightCheck(isLive: boolean): {
  allowed: boolean;
  reason: string;
} {
  if (!isLive) return { allowed: true, reason: 'Simulation mode — no restrictions' };

  const stats = loadStats();

  // Check if daily limit was already hit
  if (stats.totalLiveProfit <= -SAFETY.MAX_DAILY_LOSS) {
    return {
      allowed: false,
      reason: `Daily loss limit already hit (-$${Math.abs(stats.totalLiveProfit).toFixed(2)}). Wait until tomorrow.`,
    };
  }

  // Check if session was stopped
  if (stats.totalLiveProfit <= -SAFETY.MAX_SESSION_LOSS) {
    return {
      allowed: false,
      reason: `Session loss limit already hit. Reset session first.`,
    };
  }

  return { allowed: true, reason: 'Live trading approved. Safety guards active.' };
}

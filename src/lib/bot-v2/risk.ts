'use client';

// === Risk Manager v3 — Adaptive Kelly + Drawdown Protection ===
// Kelly criterion + dynamic staking + session protection + balance awareness.

export interface RiskConfig {
  baseStake: number;
  kellyFraction: number;
  maxStakeMultiplier: number;
  minStakeMultiplier: number;
  maxSessionLoss: number;
  maxConsecutiveLosses: number;
  lossReductionFactor: number;
  winIncreaseFactor: number;
  winStreakThreshold: number;
  maxDrawdownPct: number;       // v3: max % of balance to lose
  recoveryModeThreshold: number; // v3: switch to conservative after this many consecutive losses
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  baseStake: 0.35,
  kellyFraction: 0.25,
  maxStakeMultiplier: 3.0,
  minStakeMultiplier: 0.25,
  maxSessionLoss: 50,
  maxConsecutiveLosses: 5,
  lossReductionFactor: 0.5,
  winIncreaseFactor: 1.2,
  winStreakThreshold: 3,
  maxDrawdownPct: 5,            // stop if 5% of balance lost
  recoveryModeThreshold: 3,     // enter recovery mode after 3 consecutive losses
};

export interface RiskState {
  sessionProfit: number;
  startBalance: number;       // v3: track starting balance for drawdown
  consecutiveWins: number;
  consecutiveLosses: number;
  stakeMultiplier: number;
  stopped: boolean;
  stopReason: string | null;
  recoveryMode: boolean;      // v3: conservative mode after losses
  peakProfit: number;          // v3: track peak for drawdown from peak
}

// Kelly criterion: f* = (bp - q) / b
// b = net profit ratio, p = win prob, q = 1-p
export function kellyStake(
  winProb: number,
  profitRatio: number,
  baseStake: number,
  fraction: number = 0.25
): number {
  const b = profitRatio;
  const p = winProb;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  if (kelly <= 0) return baseStake * 0.25;
  // Use fractional Kelly (quarter Kelly is standard for risk management)
  const stake = baseStake * (1 + kelly * fraction);
  return Math.max(baseStake * 0.25, Math.min(baseStake * 3, stake));
}

// v3: Adaptive Kelly fraction based on recent performance
function getAdaptiveKellyFraction(state: RiskState): number {
  if (state.recoveryMode) return 0.10; // very conservative in recovery
  if (state.consecutiveWins >= 3) return 0.35; // more aggressive when hot
  return 0.25; // standard quarter-Kelly
}

export function calculateOptimalStake(
  winProb: number,
  contractType: string,
  config: RiskConfig,
  riskState: RiskState,
  currentBalance: number = 0
): { stake: number; reason: string } {
  // Check hard stop: session loss
  if (config.maxSessionLoss > 0 && riskState.sessionProfit <= -config.maxSessionLoss) {
    return { stake: 0, reason: `Session loss limit: -$${Math.abs(riskState.sessionProfit).toFixed(2)}` };
  }

  // v3: Check drawdown from peak
  if (config.maxDrawdownPct > 0 && riskState.startBalance > 0) {
    const drawdownPct = (Math.max(0, -riskState.sessionProfit) / riskState.startBalance) * 100;
    if (drawdownPct >= config.maxDrawdownPct) {
      return { stake: 0, reason: `Drawdown ${drawdownPct.toFixed(1)}% >= ${config.maxDrawdownPct}% limit` };
    }
  }

  // v3: Check balance-aware staking (never risk more than 1% of balance per trade)
  if (currentBalance > 0) {
    const maxPerTrade = currentBalance * 0.01;
    if (config.baseStake > maxPerTrade) {
      // Adjust base stake down
      config = { ...config, baseStake: Math.round(maxPerTrade * 100) / 100 };
    }
  }

  const profitRatio = contractType === 'DIGITMATCH' ? 8.5 : 0.85;

  // Step 1: Adaptive Kelly-based stake
  const kellyFrac = getAdaptiveKellyFraction(riskState);
  let stake = kellyStake(winProb, profitRatio, config.baseStake, kellyFrac);

  // Step 2: Apply consecutive loss reduction (exponential)
  if (riskState.consecutiveLosses >= 2) {
    const reduction = Math.pow(config.lossReductionFactor, Math.floor(riskState.consecutiveLosses / 2));
    stake *= reduction;
  }

  // Step 3: Apply win streak increase (scale up when hot)
  if (riskState.consecutiveWins >= config.winStreakThreshold) {
    const increase = Math.pow(config.winIncreaseFactor, Math.floor(riskState.consecutiveWins / config.winStreakThreshold));
    stake *= increase;
  }

  // Step 4: Recovery mode extra reduction
  if (riskState.recoveryMode) {
    stake *= 0.6;
  }

  // Step 5: Clamp
  stake = Math.max(config.baseStake * config.minStakeMultiplier, Math.min(config.baseStake * config.maxStakeMultiplier, stake));
  stake = Math.round(stake * 100) / 100;

  let reason = `Kelly${riskState.recoveryMode ? '(recovery)' : ''}: $${stake.toFixed(2)}`;
  if (riskState.consecutiveLosses >= 2) reason += ` (${riskState.consecutiveLosses}L)`;
  if (riskState.consecutiveWins >= config.winStreakThreshold) reason += ` (${riskState.consecutiveWins}W)`;

  return { stake, reason };
}

export function createRiskState(startBalance: number = 0): RiskState {
  return {
    sessionProfit: 0,
    startBalance,
    consecutiveWins: 0,
    consecutiveLosses: 0,
    stakeMultiplier: 1.0,
    stopped: false,
    stopReason: null,
    recoveryMode: false,
    peakProfit: 0,
  };
}

export function updateRiskAfterTrade(state: RiskState, profit: number, config: RiskConfig = DEFAULT_RISK_CONFIG): RiskState {
  const next = { ...state };
  next.sessionProfit += profit;

  // v3: Track peak profit
  if (next.sessionProfit > next.peakProfit) {
    next.peakProfit = next.sessionProfit;
  }

  if (profit > 0) {
    next.consecutiveWins++;
    next.consecutiveLosses = 0;
    // Exit recovery mode after a win
    if (next.recoveryMode && next.consecutiveWins >= 2) {
      next.recoveryMode = false;
    }
  } else {
    next.consecutiveLosses++;
    next.consecutiveWins = 0;
    // v3: Enter recovery mode
    if (next.consecutiveLosses >= config.recoveryModeThreshold) {
      next.recoveryMode = true;
    }
  }

  return next;
}

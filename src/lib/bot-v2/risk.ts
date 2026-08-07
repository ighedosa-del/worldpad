'use client';

// === Risk Manager v2 (No React) ===
// Kelly criterion + dynamic staking + session protection.

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
};

export interface RiskState {
  sessionProfit: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  stakeMultiplier: number;
  stopped: boolean;
  stopReason: string | null;
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
  const stake = baseStake * (1 + kelly * fraction);
  return Math.max(baseStake * 0.25, Math.min(baseStake * 3, stake));
}

export function calculateOptimalStake(
  winProb: number,
  contractType: string,
  config: RiskConfig,
  riskState: RiskState
): { stake: number; reason: string } {
  // Check hard stop
  if (riskState.sessionProfit <= -config.maxSessionLoss) {
    return { stake: 0, reason: `Session loss limit hit: -$${Math.abs(riskState.sessionProfit).toFixed(2)}` };
  }

  const profitRatio = contractType === 'DIGITMATCH' ? 8.5 : 0.85;

  // Step 1: Kelly-based stake
  let stake = kellyStake(winProb, profitRatio, config.baseStake, config.kellyFraction);

  // Step 2: Apply consecutive loss reduction
  if (riskState.consecutiveLosses >= config.maxConsecutiveLosses) {
    const reduction = Math.pow(config.lossReductionFactor, Math.floor(riskState.consecutiveLosses / config.maxConsecutiveLosses));
    stake *= reduction;
  }

  // Step 3: Apply win streak increase (scale up when hot)
  if (riskState.consecutiveWins >= config.winStreakThreshold) {
    const increase = Math.pow(config.winIncreaseFactor, Math.floor(riskState.consecutiveWins / config.winStreakThreshold));
    stake *= increase;
  }

  // Step 4: Clamp
  stake = Math.max(config.baseStake * config.minStakeMultiplier, Math.min(config.baseStake * config.maxStakeMultiplier, stake));
  stake = Math.round(stake * 100) / 100;

  let reason = `Kelly: $${stake.toFixed(2)}`;
  if (riskState.consecutiveLosses >= 2) reason += ` (${riskState.consecutiveLosses}L)`;
  if (riskState.consecutiveWins >= config.winStreakThreshold) reason += ` (${riskState.consecutiveWins}W)`;

  return { stake, reason };
}

export function createRiskState(): RiskState {
  return {
    sessionProfit: 0,
    consecutiveWins: 0,
    consecutiveLosses: 0,
    stakeMultiplier: 1.0,
    stopped: false,
    stopReason: null,
  };
}

export function updateRiskAfterTrade(state: RiskState, profit: number): RiskState {
  const next = { ...state };
  next.sessionProfit += profit;
  if (profit > 0) {
    next.consecutiveWins++;
    next.consecutiveLosses = 0;
  } else {
    next.consecutiveLosses++;
    next.consecutiveWins = 0;
  }
  return next;
}

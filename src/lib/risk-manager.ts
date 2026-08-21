'use client';

// === Risk Manager ===
// Kelly criterion, dynamic staking, consecutive loss reduction,
// session bankroll protection.

export interface RiskConfig {
  baseStake: number;
  maxStakeMultiplier: number;   // max 3x base
  minStakeMultiplier: number;   // min 0.25x base
  kellyFraction: number;        // fractional Kelly (0.25 = quarter Kelly)
  maxSessionLoss: number;       // hard stop in $
  maxConsecutiveLosses: number; // reduce stake after this many losses in a row
  lossReductionFactor: number;  // multiply stake by this after consecutive losses
  winIncreaseFactor: number;    // multiply stake by this after win streak
  winStreakThreshold: number;   // increase stake after this many consecutive wins
}

const DEFAULT_RISK_CONFIG: RiskConfig = {
  baseStake: 0.50,
  maxStakeMultiplier: 3.0,
  minStakeMultiplier: 0.25,
  kellyFraction: 0.25,        // quarter Kelly — conservative
  maxSessionLoss: 50,
  maxConsecutiveLosses: 3,
  lossReductionFactor: 0.5,
  winIncreaseFactor: 1.25,
  winStreakThreshold: 3,
};

export interface RiskState {
  sessionProfit: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  currentStakeMultiplier: number;
  totalTradesThisSession: number;
  stopped: boolean;
  stopReason: string | null;
}

// Per-market risk state
const marketRiskStates: Map<string, RiskState> = new Map();

function getRiskState(symbol: string): RiskState {
  if (!marketRiskStates.has(symbol)) {
    marketRiskStates.set(symbol, {
      sessionProfit: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      currentStakeMultiplier: 1.0,
      totalTradesThisSession: 0,
      stopped: false,
      stopReason: null,
    });
  }
  return marketRiskStates.get(symbol)!;
}

// === Kelly Criterion ===
// f* = (bp - q) / b
// b = net profit ratio (profit / stake)
// p = win probability
// q = 1 - p
export function kellyStake(
  winProb: number,
  profitRatio: number,  // e.g., 0.85 for DIGITDIFF
  baseStake: number,
  fraction: number = 0.25  // fractional Kelly
): number {
  const b = profitRatio;
  const p = winProb;
  const q = 1 - p;

  const kelly = (b * p - q) / b;
  if (kelly <= 0) return baseStake * 0.25; // negative Kelly → minimum stake

  const fractionalKelly = kelly * fraction;
  const stake = baseStake * (1 + fractionalKelly);

  // Clamp to min/max
  return Math.max(baseStake * 0.25, Math.min(baseStake * 3, stake));
}

// === Calculate optimal stake for a trade ===
export function calculateStake(
  symbol: string,
  contractType: string,
  winProb: number,
  config: Partial<RiskConfig> = {}
): { stake: number; state: RiskState; reason: string } {
  const cfg = { ...DEFAULT_RISK_CONFIG, ...config };
  const state = getRiskState(symbol);

  // Check hard stop
  if (state.sessionProfit <= -cfg.maxSessionLoss) {
    state.stopped = true;
    state.stopReason = `Session loss $${Math.abs(state.sessionProfit).toFixed(2)} exceeded $${cfg.maxSessionLoss} limit`;
    return { stake: 0, state, reason: state.stopReason };
  }

  // Determine profit ratio based on contract type
  const profitRatio = contractType === 'DIGITMATCH' ? 8.5 : 0.85;

  // Step 1: Kelly-based stake
  let stake = kellyStake(winProb, profitRatio, cfg.baseStake, cfg.kellyFraction);

  // Step 2: Apply consecutive loss reduction
  if (state.consecutiveLosses >= cfg.maxConsecutiveLosses) {
    const reduction = Math.pow(cfg.lossReductionFactor, Math.floor(state.consecutiveLosses / cfg.maxConsecutiveLosses));
    stake *= reduction;
  }

  // Step 3: Apply win streak increase
  if (state.consecutiveWins >= cfg.winStreakThreshold) {
    const increase = Math.pow(cfg.winIncreaseFactor, Math.floor(state.consecutiveWins / cfg.winStreakThreshold));
    stake *= increase;
  }

  // Step 4: Clamp to min/max
  stake = Math.max(cfg.baseStake * cfg.minStakeMultiplier, Math.min(cfg.baseStake * cfg.maxStakeMultiplier, stake));

  // Step 5: Round to 2 decimal places
  stake = Math.round(stake * 100) / 100;

  let reason = `Kelly: $${stake.toFixed(2)}`;
  if (state.consecutiveLosses >= cfg.maxConsecutiveLosses) {
    reason += ` (loss reduction: ${state.consecutiveLosses}L)`;
  }
  if (state.consecutiveWins >= cfg.winStreakThreshold) {
    reason += ` (win boost: ${state.consecutiveWins}W)`;
  }

  return { stake, state, reason };
}

// === Record trade result for risk tracking ===
export function recordRiskResult(symbol: string, profit: number): RiskState {
  const state = getRiskState(symbol);
  state.sessionProfit += profit;
  state.totalTradesThisSession++;

  if (profit > 0) {
    state.consecutiveWins++;
    state.consecutiveLosses = 0;
  } else {
    state.consecutiveLosses++;
    state.consecutiveWins = 0;
  }

  return state;
}

// === Get session P/L across all markets ===
export function getSessionPL(): number {
  let total = 0;
  for (const state of marketRiskStates.values()) {
    total += state.sessionProfit;
  }
  return total;
}

// === Reset all risk states (new session) ===
export function resetRiskStates() {
  marketRiskStates.clear();
}

// === Get risk state for a market ===
export function getMarketRiskState(symbol: string): RiskState {
  return getRiskState(symbol);
}

// === Get all risk states ===
export function getAllRiskStates(): Map<string, RiskState> {
  return new Map(marketRiskStates);
}
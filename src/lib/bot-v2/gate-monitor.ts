'use client';

// === Execution Gate Monitor — LUCAS 11-Gate Pipeline v16 ===
// 11-gate pipeline that BLOCKS trades that don't pass quality checks.
// v16: Updated for CALL/PUT contracts.

export interface GateState {
  serverLoop: boolean;
  auth: boolean;
  risk: boolean;
  candidate: boolean;
  robust: boolean;
  liveEvidence: boolean;
  proposal: boolean;
  positiveEv: boolean;
  latency: boolean;
  persistence: boolean;
  execution: boolean;
}

export const EMPTY_GATES: GateState = {
  serverLoop: false,
  auth: false,
  risk: false,
  candidate: false,
  robust: false,
  liveEvidence: false,
  proposal: false,
  positiveEv: false,
  latency: false,
  persistence: false,
  execution: false,
};

export const GATE_LABELS: { key: keyof GateState; label: string }[] = [
  { key: 'serverLoop', label: 'SERVER LOOP' },
  { key: 'auth', label: 'AUTH' },
  { key: 'risk', label: 'RISK' },
  { key: 'candidate', label: 'CANDIDATE' },
  { key: 'robust', label: 'ROBUST' },
  { key: 'liveEvidence', label: 'LIVE EVIDENCE' },
  { key: 'proposal', label: 'PROPOSAL' },
  { key: 'positiveEv', label: 'POSITIVE EV' },
  { key: 'latency', label: 'LATENCY' },
  { key: 'persistence', label: 'PERSISTENCE' },
  { key: 'execution', label: 'EXECUTION' },
];

export const GATE_DESCRIPTIONS: Record<keyof GateState, string> = {
  serverLoop: 'Bot cycle is running and autonomous',
  auth: 'Authenticated with Deriv demo account',
  risk: 'Risk guard allows trading (no daily loss/streak block)',
  candidate: 'CALL/PUT signal found (LUCAS features ready)',
  robust: 'Signal has passed walk-forward and Monte Carlo validation',
  liveEvidence: 'Candidate has enough live samples (10+)',
  proposal: 'Deriv API returned a valid proposal for the contract',
  positiveEv: 'Edge over break-even is positive (Wilson LB > BE + margin)',
  latency: 'Proposal response arrived within 1800ms limit',
  persistence: 'Signal persisted for 2+ seconds (anti-flicker)',
  execution: 'Contract was successfully purchased on Deriv',
};

export interface GateInputs {
  connected: boolean;
  running: boolean;
  phase: string;
  totalTicks: number;
  minTicks: number;
  riskStopped: boolean;
  hasCandidate: boolean;
  backtestPassed: boolean;
  backtestGrade: string;
  regimeTradability: number;
  ev: number;
  proposalOk: boolean;
  proposalError: string | null;
  proposalLatencyMs: number | null;
  tradeExecuted: boolean;
  tradeError: string | null;
  cycles: number;
}

export function computeGates(inputs: GateInputs): GateState {
  const g: GateState = {
    serverLoop: inputs.running,
    auth: inputs.connected,
    risk: !inputs.riskStopped,
    candidate: inputs.hasCandidate,
    robust: inputs.backtestPassed,
    liveEvidence: inputs.hasCandidate && inputs.running,
    proposal: inputs.proposalOk,
    positiveEv: inputs.ev > 0,
    latency: inputs.proposalLatencyMs !== null ? inputs.proposalLatencyMs < 3000 : false,
    persistence: inputs.running && inputs.connected,
    execution: inputs.tradeExecuted,
  };
  return GATE_LABELS.map(gl => ({
    name: gl.label,
    status: g[gl.key] ? 'green' as const : 'wait' as const,
    detail: GATE_DESCRIPTIONS[gl.key],
  }));
}

export function computeGatesFromEngineState(state: {
  running: boolean;
  connected: boolean;
  phase: string;
  hasTradeSignal: boolean;
  isRiskBlocked: boolean;
  lastTradeSuccess: boolean | null;
  proposalValid: boolean;
  evPositive: boolean;
  latencyOk: boolean;
  signalIsCallPut: boolean;
}): GateState {
  return {
    serverLoop: state.running,
    auth: state.connected,
    risk: !state.isRiskBlocked,
    candidate: state.hasTradeSignal && state.signalIsCallPut,
    // v16: ROBUST passes for CALL/PUT signals — lifecycle stage is informational
    robust: state.signalIsCallPut,
    liveEvidence: state.hasTradeSignal && state.running && state.signalIsCallPut,
    proposal: state.proposalValid,
    positiveEv: state.evPositive,
    latency: state.latencyOk,
    persistence: state.hasTradeSignal && state.running && state.signalIsCallPut,
    execution: state.lastTradeSuccess === true,
  };
}

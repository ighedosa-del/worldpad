'use client';

// === Execution Gate Monitor — LUCAS 11-Gate Pipeline v17 ===
// v17: Fixed computeGates to return GateState (was returning array).

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
  auth: 'Authenticated with Deriv',
  risk: 'Risk guard allows trading (no daily loss/streak block)',
  candidate: 'Trade signal found',
  robust: 'Signal has passed validation',
  liveEvidence: 'Candidate has enough live samples',
  proposal: 'Deriv API returned a valid proposal',
  positiveEv: 'Edge over break-even is positive',
  latency: 'Proposal response arrived within 3000ms',
  persistence: 'Signal persisted (anti-flicker)',
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

// v17 FIX: Was returning GATE_LABELS.map(...) which returns an array.
// Now correctly returns a GateState object.
export function computeGates(inputs: GateInputs): GateState {
  return {
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
}

// Helper to convert GateState to display array for UI
export function gatesToDisplay(gates: GateState): { name: string; status: 'green' | 'wait' | 'red'; detail: string }[] {
  return GATE_LABELS.map(gl => ({
    name: gl.label,
    status: gates[gl.key] ? 'green' as const : 'wait' as const,
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
    robust: state.signalIsCallPut,
    liveEvidence: state.hasTradeSignal && state.running && state.signalIsCallPut,
    proposal: state.proposalValid,
    positiveEv: state.evPositive,
    latency: state.latencyOk,
    persistence: state.hasTradeSignal && state.running && state.signalIsCallPut,
    execution: state.lastTradeSuccess === true,
  };
}
'use client';

import { create } from 'zustand';
import type { AuthResult, AccountInfo } from './types';
import type { BotStats, TradeRecord } from './engine';
import type { GateState } from './gate-monitor';
import type { MarketFeatures } from './market-features';

export interface RankedMarketDisplay {
  symbol: string;
  name: string;
  score: number;
  signal: string;
  totalTicks: number;
  lastDigit: number;
  ev?: number;
  regime?: string;
  backtestGrade?: string;
}

export interface MarketDataDisplay {
  symbol: string;
  name: string;
  digit: number;
  price: number;
  distribution: number[];
  totalTicks: number;
}

export interface BotStoreState {
  // Connection
  connected: boolean;
  auth: AuthResult | null;
  connectionError: string | null;
  isVirtual: boolean;
  balance: number;
  accountList: AccountInfo[];
  switchingAccount: boolean;

  // Bot
  running: boolean;
  phase: 'idle' | 'connecting' | 'collecting' | 'scanning' | 'trading' | 'stopped';
  stats: BotStats | null;
  ticks: number;

  // Config
  stake: number;
  stopLoss: number;
  takeProfit: number;
  maxConsecutiveLosses: number;
  cycleIntervalMs: number;
  activeStrategy: string;

  // Data
  rankedMarkets: RankedMarketDisplay[];
  marketData: MarketDataDisplay[];
  tradeHistory: TradeRecord[];

  // LUCAS Modules
  gates: GateState;
  marketFeatures: Record<string, MarketFeatures>;
  robustnessStage: string;
  insights: { level: string; text: string }[];

  // Logs
  logs: string[];

  // App ID & Token
  appId: string;
  token: string;

  // Actions
  updateState: (partial: Partial<BotStoreState>) => void;
  addLog: (msg: string) => void;
  clearLogs: () => void;
  setConfig: (config: Partial<Pick<BotStoreState, 'stake' | 'stopLoss' | 'takeProfit' | 'maxConsecutiveLosses' | 'cycleIntervalMs' | 'activeStrategy'>>) => void;
  setAppId: (id: string) => void;
  setToken: (token: string) => void;
  resetSession: () => void;
}

const defaultGates: GateState = {
  serverLoop: false, auth: false, risk: false, candidate: false,
  robust: false, liveEvidence: false, proposal: false, positiveEv: false,
  latency: false, persistence: false, execution: false,
};

export const useBotStore = create<BotStoreState>((set) => ({
  connected: false,
  auth: null,
  connectionError: null,
  isVirtual: true,
  balance: 0,
  accountList: [],
  switchingAccount: false,

  running: false,
  phase: 'idle',
  stats: null,
  ticks: 0,

  stake: 0.40,
  stopLoss: 6,
  takeProfit: 2,
  maxConsecutiveLosses: 10,
  cycleIntervalMs: 2000,
  activeStrategy: 'even-odd-alt',

  appId: '',
  token: '',

  rankedMarkets: [],
  marketData: [],
  tradeHistory: [],

  gates: { ...defaultGates },
  marketFeatures: {},
  robustnessStage: 'RESEARCH',
  insights: [],

  logs: [],

  updateState: (partial) => set(partial),

  addLog: (msg) => set((s) => ({
    logs: [...s.logs.slice(-499), `[${new Date().toLocaleTimeString()}] ${msg}`],
  })),

  clearLogs: () => set({ logs: [] }),

  setConfig: (config) => set(config),

  setAppId: (id) => {
    set({ appId: id });
    if (typeof window !== 'undefined') localStorage.setItem('deriv-app-id', id);
  },

  setToken: (t) => {
    set({ token: t });
    if (typeof window !== 'undefined') localStorage.setItem('deriv-token', t);
  },

  resetSession: () => set({
    running: false,
    phase: 'idle',
    stats: null,
    ticks: 0,
    rankedMarkets: [],
    tradeHistory: [],
    gates: { ...defaultGates },
    marketFeatures: {},
    robustnessStage: 'RESEARCH',
    insights: [],
  }),
}));

// === Singleton bot instance ===
import { DerivBot, DEFAULT_CONFIG, type BotConfig } from './engine';

let botInstance: DerivBot | null = null;

export function getBot(): DerivBot {
  if (!botInstance) {
    const appId = useBotStore.getState().appId;

    botInstance = new DerivBot(
      appId,
      (partial) => {
        useBotStore.getState().updateState(partial);
      },
      (msg) => {
        useBotStore.getState().addLog(msg);
      }
    );
  }
  return botInstance;
}

export function destroyBot(): void {
  if (botInstance) {
    botInstance.destroy();
    botInstance = null;
  }
}

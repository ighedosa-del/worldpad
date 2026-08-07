'use client';

import { create } from 'zustand';
import type { AuthResult, AccountInfo } from './deriv-client';
import type { BotStats, TradeRecord } from './engine';

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
  appId: string;

  // Data
  rankedMarkets: RankedMarketDisplay[];
  marketData: MarketDataDisplay[];
  tradeHistory: TradeRecord[];

  // Logs
  logs: string[];

  // Actions
  updateState: (partial: Partial<BotStoreState>) => void;
  addLog: (msg: string) => void;
  clearLogs: () => void;
  setConfig: (config: Partial<Pick<BotStoreState, 'stake' | 'stopLoss' | 'takeProfit' | 'maxConsecutiveLosses' | 'cycleIntervalMs'>>) => void;
  resetSession: () => void;
}

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

  stake: 0.35,
  stopLoss: 10,
  takeProfit: 20,
  maxConsecutiveLosses: 5,
  cycleIntervalMs: 2000,
  appId: '1089',

  rankedMarkets: [],
  marketData: [],
  tradeHistory: [],

  logs: [],

  updateState: (partial) => set(partial),

  addLog: (msg) => set((s) => ({
    logs: [...s.logs.slice(-499), `[${new Date().toLocaleTimeString()}] ${msg}`],
  })),

  clearLogs: () => set({ logs: [] }),

  setConfig: (config) => set(config),

  resetSession: () => set({
    running: false,
    phase: 'idle',
    stats: null,
    ticks: 0,
    rankedMarkets: [],
    tradeHistory: [],
  }),
}));

// === Singleton bot instance ===
import { DerivBot, DEFAULT_CONFIG, type BotConfig } from './engine';

let botInstance: DerivBot | null = null;

export function getBot(): DerivBot {
  const appId = useBotStore.getState().appId || process.env.NEXT_PUBLIC_DERIV_APP_ID || '1089';
  if (!botInstance) {
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

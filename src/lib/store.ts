import { create } from 'zustand';
import type { DerivAccount } from './deriv-ws';

export interface BotConfig {
  market: string;
  subMarket: string;
  tradeType: string;
  subType: string;
  contractType: string;
  candleInterval: string;
  stake: number;
  expectedProfit: number;
  stopLoss: number;
  martingale: number;
  duration: string;
  durationValue: number;
  predictionFrom: number;
  predictionTo: number;
}

export interface TradeResult {
  id: string;
  type: string;
  symbol: string;
  stake: number;
  payout: number;
  profit: number;
  digit: number;
  won: boolean;
  timestamp: number;
}

export interface WorldpadState {
  activeTab: string;
  balance: number;
  isConnecting: boolean;
  isConnected: boolean;
  activeMarket: string;
  ticks: number;
  livePrice: number;
  currentDigit: number;
  digitDistribution: number[];
  overUnderHistory: string[];
  matchDifferHistory: string[];
  evenOddHistory: string[];
  riseFallHistory: string[];
  digitHistory: number[];
  isBotRunning: boolean;
  fastSpeed: boolean;
  botConfig: BotConfig;
  autoTraderLogs: string[];
  selectedAnalysisDigit: number;
  analysisOverUnderDigit: number;
  analysisMatchDifferDigit: number;
  tickCount: number;
  lastTickTime: number;
  // Auth & Trading
  apiToken: string;
  demoToken: string;
  realToken: string;
  derivAppId: string;
  accountMode: 'demo' | 'real';
  selectedAccountId: string;
  availableAccounts: DerivAccount[];
  isAuthorized: boolean;
  authorizing: boolean;
  accountInfo: { fullname: string; loginid: string; balance: number; currency: string } | null;
  tradeHistory: TradeResult[];
  isPlacingTrade: boolean;
  totalWins: number;
  totalLosses: number;
  totalProfit: number;
  // Bot session
  botTradeCount: number;
  botSessionProfit: number;
  botConsecutiveLosses: number;
  activeBotId: string | null;
  activeBotStrategy: string | null;

  setActiveTab: (tab: string) => void;
  setBalance: (balance: number) => void;
  setIsConnecting: (val: boolean) => void;
  setIsConnected: (val: boolean) => void;
  setActiveMarket: (market: string) => void;
  setTicks: (ticks: number) => void;
  setLivePrice: (price: number) => void;
  setCurrentDigit: (digit: number) => void;
  setDigitDistribution: (dist: number[]) => void;
  addOverUnderHistory: (entry: string) => void;
  addMatchDifferHistory: (entry: string) => void;
  addEvenOddHistory: (entry: string) => void;
  addRiseFallHistory: (entry: string) => void;
  addDigitHistory: (digit: number) => void;
  setIsBotRunning: (val: boolean) => void;
  setFastSpeed: (val: boolean) => void;
  updateBotConfig: (config: Partial<BotConfig>) => void;
  addAutoTraderLog: (log: string) => void;
  clearAutoTraderLogs: () => void;
  setSelectedAnalysisDigit: (digit: number) => void;
  setAnalysisOverUnderDigit: (digit: number) => void;
  setAnalysisMatchDifferDigit: (digit: number) => void;
  incrementTickCount: () => void;
  setLastTickTime: (time: number) => void;
  // Auth & Trading actions
  setApiToken: (token: string) => void;
  setDemoToken: (token: string) => void;
  setRealToken: (token: string) => void;
  setDerivAppId: (id: string) => void;
  setAccountMode: (mode: 'demo' | 'real') => void;
  setSelectedAccountId: (id: string) => void;
  setAvailableAccounts: (accounts: DerivAccount[]) => void;
  setIsAuthorized: (val: boolean) => void;
  setAuthorizing: (val: boolean) => void;
  setAccountInfo: (info: WorldpadState['accountInfo']) => void;
  addTradeResult: (result: TradeResult) => void;
  setIsPlacingTrade: (val: boolean) => void;
  setBotTradeCount: (count: number) => void;
  setBotSessionProfit: (profit: number) => void;
  setBotConsecutiveLosses: (count: number) => void;
  setActiveBotId: (id: string | null) => void;
  setActiveBotStrategy: (strategy: string | null) => void;
  resetBotSession: () => void;
}

const defaultBotConfig: BotConfig = {
  market: 'Derived',
  subMarket: 'Continuous Indices',
  tradeType: 'Digits',
  subType: 'Over/Under',
  contractType: 'Both',
  candleInterval: '1 minute',
  stake: 0.5,
  expectedProfit: 5,
  stopLoss: 50,
  martingale: 2,
  duration: 'Ticks',
  durationValue: 1,
  predictionFrom: 7,
  predictionTo: 9,
};

export const useWorldpadStore = create<WorldpadState>((set) => ({
  activeTab: 'landing',
  balance: 10234.50,
  isConnecting: false,
  isConnected: false,
  activeMarket: 'R_100',
  ticks: 1000,
  livePrice: 0,
  currentDigit: 0,
  digitDistribution: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
  overUnderHistory: [],
  matchDifferHistory: [],
  evenOddHistory: [],
  riseFallHistory: [],
  digitHistory: [],
  isBotRunning: false,
  fastSpeed: false,
  botConfig: defaultBotConfig,
  autoTraderLogs: [],
  selectedAnalysisDigit: 0,
  analysisOverUnderDigit: 1,
  analysisMatchDifferDigit: 5,
  tickCount: 0,
  lastTickTime: 0,
  // Auth & Trading
  apiToken: '',
  demoToken: '',
  realToken: '',
  derivAppId: '',
  accountMode: 'demo',
  selectedAccountId: '',
  availableAccounts: [],
  isAuthorized: false,
  authorizing: false,
  accountInfo: null,
  tradeHistory: [],
  isPlacingTrade: false,
  totalWins: 0,
  totalLosses: 0,
  totalProfit: 0,
  botTradeCount: 0,
  botSessionProfit: 0,
  botConsecutiveLosses: 0,
  activeBotId: null,
  activeBotStrategy: null,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setBalance: (balance) => set({ balance }),
  setIsConnecting: (val) => set({ isConnecting: val }),
  setIsConnected: (val) => set({ isConnected: val }),
  setActiveMarket: (market) => set({ activeMarket: market }),
  setTicks: (ticks) => set({ ticks }),
  setLivePrice: (price) => set({ livePrice: price }),
  setCurrentDigit: (digit) => set({ currentDigit: digit }),
  setDigitDistribution: (dist) => set({ digitDistribution: dist }),
  addOverUnderHistory: (entry) => set((s) => ({
    overUnderHistory: [...s.overUnderHistory.slice(-49), entry]
  })),
  addMatchDifferHistory: (entry) => set((s) => ({
    matchDifferHistory: [...s.matchDifferHistory.slice(-49), entry]
  })),
  addEvenOddHistory: (entry) => set((s) => ({
    evenOddHistory: [...s.evenOddHistory.slice(-49), entry]
  })),
  addRiseFallHistory: (entry) => set((s) => ({
    riseFallHistory: [...s.riseFallHistory.slice(-49), entry]
  })),
  addDigitHistory: (digit) => set((s) => ({
    digitHistory: [...s.digitHistory.slice(-999), digit]
  })),
  setIsBotRunning: (val) => set({ isBotRunning: val }),
  setFastSpeed: (val) => set({ fastSpeed: val }),
  updateBotConfig: (config) => set((s) => ({
    botConfig: { ...s.botConfig, ...config }
  })),
  addAutoTraderLog: (log) => set((s) => ({
    autoTraderLogs: [...s.autoTraderLogs.slice(-199), log]
  })),
  clearAutoTraderLogs: () => set({ autoTraderLogs: [] }),
  setSelectedAnalysisDigit: (digit) => set({ selectedAnalysisDigit: digit }),
  setAnalysisOverUnderDigit: (digit) => set({ analysisOverUnderDigit: digit }),
  setAnalysisMatchDifferDigit: (digit) => set({ analysisMatchDifferDigit: digit }),
  incrementTickCount: () => set((s) => ({ tickCount: s.tickCount + 1 })),
  setLastTickTime: (time) => set({ lastTickTime: time }),
  // Auth & Trading actions
  setApiToken: (token) => set({ apiToken: token }),
  setDerivAppId: (id) => set({ derivAppId: id }),
  setSelectedAccountId: (id) => set({ selectedAccountId: id }),
  setAvailableAccounts: (accounts) => set({ availableAccounts: accounts }),
  setDemoToken: (token) => set((s) => ({
    demoToken: token,
    // If currently in demo mode, also update active token
    ...(s.accountMode === 'demo' ? { apiToken: token } : {}),
  })),
  setRealToken: (token) => set((s) => ({
    realToken: token,
    // If currently in real mode, also update active token
    ...(s.accountMode === 'real' ? { apiToken: token } : {}),
  })),
  setAccountMode: (mode) => set((s) => {
    const token = mode === 'demo' ? s.demoToken : s.realToken;
    return {
      accountMode: mode,
      apiToken: token,
      isAuthorized: !!token,
    };
  }),
  setIsAuthorized: (val) => set({ isAuthorized: val }),
  setAuthorizing: (val) => set({ authorizing: val }),
  setAccountInfo: (info) => set({ accountInfo: info }),
  addTradeResult: (result) => set((s) => {
    const newHistory = [...s.tradeHistory.slice(-99), result];
    return {
      tradeHistory: newHistory,
      totalWins: s.totalWins + (result.won ? 1 : 0),
      totalLosses: s.totalLosses + (result.won ? 0 : 1),
      totalProfit: s.totalProfit + result.profit,
      balance: s.balance + result.profit,
    };
  }),
  setIsPlacingTrade: (val) => set({ isPlacingTrade: val }),
  setBotTradeCount: (count) => set({ botTradeCount: count }),
  setBotSessionProfit: (profit) => set({ botSessionProfit: profit }),
  setBotConsecutiveLosses: (count) => set({ botConsecutiveLosses: count }),
  setActiveBotId: (id) => set({ activeBotId: id }),
  setActiveBotStrategy: (strategy) => set({ activeBotStrategy: strategy }),
  resetBotSession: () => set({ botTradeCount: 0, botSessionProfit: 0, botConsecutiveLosses: 0, activeBotId: null, activeBotStrategy: null }),
}));

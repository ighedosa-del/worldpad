import { create } from 'zustand';
import type { DerivAccount } from './deriv-ws';
import type { RankedMarket } from './market-scorer';

// ScannerHealth type (inlined to avoid circular dep with use-ai-bot.ts)
export interface ScannerHealth {
  isConnected: boolean;
  totalTicksReceived: number;
  lastTickTime: number;
  connectTime: number;
  ticksPerMarket: Record<string, number>;
  wsError: string | null;
  callbackCount: number;
}

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
  // Global AI state (runs across all tabs)
  globalAIRunning: boolean;
  globalAIRankedMarkets: RankedMarket[];
  globalAICycleCount: number;
  globalAITotalTrades: number;
  globalAITotalProfit: number;
  globalAIStatus: 'idle' | 'scanning' | 'trading' | 'waiting';
  globalAIHealth: ScannerHealth;
  globalAILearningStats: { strategiesLearned: number; totalTradesRecorded: number; totalWins: number; totalLosses: number; totalProfit: number; winRate: number };

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
  // Global AI actions
  setGlobalAIRunning: (val: boolean) => void;
  setGlobalAIRankedMarkets: (markets: RankedMarket[]) => void;
  setGlobalAICycleCount: (count: number) => void;
  setGlobalAITotalTrades: (count: number) => void;
  setGlobalAITotalProfit: (profit: number) => void;
  setGlobalAIStatus: (status: 'idle' | 'scanning' | 'trading' | 'waiting') => void;
  setGlobalAIHealth: (health: ScannerHealth) => void;
  setGlobalAILearningStats: (stats: { strategiesLearned: number; totalTradesRecorded: number; totalWins: number; totalLosses: number; totalProfit: number; winRate: number }) => void;
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

// v5: Persist auth state to localStorage so connection survives page reloads
const AUTH_STORAGE_KEY = 'wp-auth-persist';

function loadAuthFromStorage(): Partial<WorldpadState> {
  if (typeof window === 'undefined') return {};
  try {
    const saved = localStorage.getItem(AUTH_STORAGE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      return {
        demoToken: data.demoToken || '',
        realToken: data.realToken || '',
        derivAppId: data.derivAppId || '',
        accountMode: data.accountMode || 'demo',
        selectedAccountId: data.selectedAccountId || '',
        isAuthorized: !!(data.demoToken || data.realToken),
      };
    }
  } catch { /* ignore */ }
  return {};
}

function saveAuthToStorage(state: WorldpadState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
      demoToken: state.demoToken,
      realToken: state.realToken,
      derivAppId: state.derivAppId,
      accountMode: state.accountMode,
      selectedAccountId: state.selectedAccountId,
    }));
  } catch { /* ignore */ }
}

const persistedAuth = loadAuthFromStorage();

export const useWorldpadStore = create<WorldpadState>((set, get) => ({
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
  // Auth & Trading (v5: loaded from localStorage)
  apiToken: persistedAuth.accountMode === 'demo' ? (persistedAuth.demoToken || '') : (persistedAuth.realToken || ''),
  demoToken: persistedAuth.demoToken || '',
  realToken: persistedAuth.realToken || '',
  derivAppId: persistedAuth.derivAppId || '',
  accountMode: persistedAuth.accountMode || 'demo',
  selectedAccountId: persistedAuth.selectedAccountId || "",
  availableAccounts: [],
  isAuthorized: persistedAuth.isAuthorized || false,
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
  // Global AI defaults
  globalAIRunning: false,
  globalAIRankedMarkets: [],
  globalAICycleCount: 0,
  globalAITotalTrades: 0,
  globalAITotalProfit: 0,
  globalAIStatus: 'idle' as const,
  globalAIHealth: { isConnected: false, totalTicksReceived: 0, lastTickTime: 0, connectTime: 0, ticksPerMarket: {}, wsError: null, callbackCount: 0 },
  globalAILearningStats: { strategiesLearned: 0, totalTradesRecorded: 0, totalWins: 0, totalLosses: 0, totalProfit: 0, winRate: 0 },

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
  setDerivAppId: (id) => set((s) => {
    const newState = { derivAppId: id };
    setTimeout(() => saveAuthToStorage({ ...get(), ...newState }), 0);
    return newState;
  }),
  setSelectedAccountId: (id) => set((s) => {
    const newState = { selectedAccountId: id };
    setTimeout(() => saveAuthToStorage({ ...get(), ...newState }), 0);
    return newState;
  }),
  setAvailableAccounts: (accounts) => set({ availableAccounts: accounts }),
  setDemoToken: (token) => set((s) => {
    const newState: any = {
      demoToken: token,
      ...(s.accountMode === 'demo' ? { apiToken: token, isAuthorized: !!token } : {}),
    };
    setTimeout(() => saveAuthToStorage({ ...get(), ...newState }), 0);
    return newState;
  }),
  setRealToken: (token) => set((s) => {
    const newState: any = {
      realToken: token,
      ...(s.accountMode === 'real' ? { apiToken: token, isAuthorized: !!token } : {}),
    };
    setTimeout(() => saveAuthToStorage({ ...get(), ...newState }), 0);
    return newState;
  }),
  setAccountMode: (mode) => set((s) => {
    const token = mode === 'demo' ? s.demoToken : s.realToken;
    const newState = {
      accountMode: mode,
      apiToken: token,
      isAuthorized: !!token,
    };
    setTimeout(() => saveAuthToStorage({ ...get(), ...newState }), 0);
    return newState;
  }),
  setIsAuthorized: (val) => set((s) => {
    if (val) setTimeout(() => saveAuthToStorage(get()), 0);
    return { isAuthorized: val };
  }),
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
  // Global AI actions
  setGlobalAIRunning: (val) => set({ globalAIRunning: val }),
  setGlobalAIRankedMarkets: (markets) => set({ globalAIRankedMarkets: markets }),
  setGlobalAICycleCount: (count) => set({ globalAICycleCount: count }),
  setGlobalAITotalTrades: (count) => set({ globalAITotalTrades: count }),
  setGlobalAITotalProfit: (profit) => set({ globalAITotalProfit: profit }),
  setGlobalAIStatus: (status) => set({ globalAIStatus: status }),
  setGlobalAIHealth: (health) => set({ globalAIHealth: health }),
  setGlobalAILearningStats: (stats) => set({ globalAILearningStats: stats }),
}));

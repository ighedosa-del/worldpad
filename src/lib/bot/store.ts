import { create } from 'zustand';
import { botEngine, type BotState, type TradeRecord, type MarketState, type BotStatus, MARKETS } from './engine';

interface BotStore extends BotState {
  // Actions
  connect: (token: string) => Promise<void>;
  start: () => void;
  stop: () => void;
  setStake: (v: number) => void;
  setStopLoss: (v: number) => void;
  setTakeProfit: (v: number) => void;
  getMarketList: () => (MarketState & { symbol: string; name: string })[];
  getRecentTrades: (n?: number) => TradeRecord[];
  winRate: () => number;
}

const initialState: BotState = {
  status: 'idle' as BotStatus,
  auth: null,
  markets: Object.fromEntries(MARKETS.map(m => [m.symbol, {
    symbol: m.symbol,
    name: m.name,
    digits: [],
    distribution: new Array(10).fill(0),
    distributionPct: new Array(10).fill(0),
    lastTick: null,
    tickCount: 0,
    lastTradeTime: 0,
    onCooldown: false,
  }])),
  trades: [],
  totalProfit: 0,
  totalTrades: 0,
  wins: 0,
  losses: 0,
  currentCycle: 0,
  logs: [],
  stake: 0.35,
  stopLoss: 10,
  takeProfit: 50,
  running: false,
};

export const useBotStore = create<BotStore>((set, get) => {
  // Sync engine state → zustand
  botEngine.onChange = (newState) => {
    set({
      status: newState.status,
      auth: newState.auth,
      markets: newState.markets,
      trades: newState.trades,
      totalProfit: newState.totalProfit,
      totalTrades: newState.totalTrades,
      wins: newState.wins,
      losses: newState.losses,
      currentCycle: newState.currentCycle,
      logs: newState.logs,
      stake: newState.stake,
      stopLoss: newState.stopLoss,
      takeProfit: newState.takeProfit,
      running: newState.running,
    });
  };

  return {
    ...initialState,

    connect: async (token: string) => {
      await botEngine.connect(token);
    },

    start: () => { botEngine.start(); },
    stop: () => { botEngine.stop(); },
    setStake: (v: number) => { botEngine.setStake(v); },
    setStopLoss: (v: number) => { botEngine.setStopLoss(v); },
    setTakeProfit: (v: number) => { botEngine.setTakeProfit(v); },

    getMarketList: () => {
      return MARKETS.map(m => get().markets[m.symbol]);
    },

    getRecentTrades: (n = 20) => {
      return get().trades.slice(0, n);
    },

    winRate: () => {
      const s = get();
      const total = s.wins + s.losses;
      return total > 0 ? (s.wins / total) * 100 : 0;
    },
  };
});

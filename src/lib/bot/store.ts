import { create } from 'zustand';
import { botEngine, type BotSnapshot, type StoredAccount, MARKETS } from './engine';

interface BotStore extends BotSnapshot {
  addAccount: (token: string) => Promise<StoredAccount | undefined>;
  removeAccount: (id: string) => void;
  switchAccount: (id: string) => Promise<void>;
  start: () => void;
  stop: () => void;
  setConfig: (c: Partial<{ stake: number; stopLoss: number; takeProfit: number }>) => void;
}

function createInitialState(): BotSnapshot {
  const markets: Record<string, BotSnapshot['markets'][string]> = {};
  for (const m of MARKETS) markets[m.symbol] = { symbol: m.symbol, name: m.name, type: m.type, digits: [], distribution: new Array(10).fill(0), distributionPct: new Array(10).fill(0), lastTick: null, tickCount: 0, lastTradeTime: 0, onCooldown: false };
  return { status: 'idle', activeAccountId: null, activeAuth: null, accounts: [], markets, trades: [], totalProfit: 0, totalTrades: 0, wins: 0, losses: 0, cycles: 0, logs: [], config: { stake: 0.35, stopLoss: 10, takeProfit: 50, cooldownMs: 5000, minBuffer: 30 }, running: false, totalTicks: 0 };
}

export const useBotStore = create<BotStore>((set, get) => {
  botEngine.onChange = (s) => set(s);
  return {
    ...createInitialState(),
    addAccount: async (token: string) => { try { return await botEngine.addAccount(token); } catch (e) { get().logs.push(`[ERROR] ${(e as Error).message}`); set({ logs: get().logs }); return undefined; } },
    removeAccount: (id: string) => botEngine.removeAccount(id),
    switchAccount: async (id: string) => { try { await botEngine.switchAccount(id); } catch (e) { get().logs.push(`[ERROR] ${(e as Error).message}`); set({ logs: get().logs }); } },
    start: () => botEngine.start(),
    stop: () => botEngine.stop(),
    setConfig: (c) => botEngine.setConfig(c),
  };
});

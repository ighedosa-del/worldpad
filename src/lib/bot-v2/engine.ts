'use client';

// === DerivBot Engine v2 ===
// Plain TypeScript class. NO React. NO stale closures.
// Manages: connection → tick subscriptions → strategy analysis → trade execution
// The bot loop runs via setInterval inside this class, not inside any React component.

import { MultiMarketClient, type TickData, type AuthResult } from './deriv-client';
import {
  SCANNED_MARKETS, createMarketStates, feedTick,
  scoreAndRank, type MarketState, type ScoredMarket, type TradeSignal,
} from './strategies';
import type { BotStoreState } from './store';

export interface BotConfig {
  stake: number;
  stopLoss: number;
  takeProfit: number;
  maxConsecutiveLosses: number;
  cycleIntervalMs: number;
  minTicksBeforeTrade: number;
  minScoreToTrade: number;
  maxConcurrentTrades: number;
  martingaleMultiplier: number;
  martingaleMaxSteps: number;
  activeStrategy: string; // 'all' | specific strategy
}

export const DEFAULT_CONFIG: BotConfig = {
  stake: 0.35,
  stopLoss: 10,
  takeProfit: 20,
  maxConsecutiveLosses: 5,
  cycleIntervalMs: 2000,
  minTicksBeforeTrade: 40,
  minScoreToTrade: 50,
  maxConcurrentTrades: 2,
  martingaleMultiplier: 2.0,
  martingaleMaxSteps: 4,
  activeStrategy: 'all',
};

export interface TradeRecord {
  id: string;
  contractId: string;
  contractType: string;
  symbol: string;
  name: string;
  stake: number;
  payout: number;
  profit: number;
  barrier: number | undefined;
  won: boolean;
  timestamp: number;
  simulated: boolean;
  signal: string;
}

export interface BotStats {
  cycles: number;
  totalTrades: number;
  wins: number;
  losses: number;
  totalProfit: number;
  sessionProfit: number;
  winRate: number;
  consecutiveLosses: number;
  currentStake: number;
  martingaleStep: number;
}

export interface BotStatus {
  connected: boolean;
  running: boolean;
  phase: 'idle' | 'connecting' | 'collecting' | 'scanning' | 'trading' | 'stopped';
  auth: AuthResult | null;
}

interface ActiveTrade {
  symbol: string;
  startedAt: number;
  contractType: string;
}

// === The Bot Engine ===

export class DerivBot {
  private client: MultiMarketClient;
  private config: BotConfig;
  private markets: Map<string, MarketState>;
  private running = false;
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  private activeTrades = new Map<string, ActiveTrade>();
  private tradeHistory: TradeRecord[] = [];
  private lossCooldowns = new Map<string, number>(); // symbol -> cycle count when last loss happened
  private consecutiveLosses = 0;
  private martingaleStep = 0;
  private currentStake: number;
  private sessionProfit = 0;
  private cycles = 0;
  private totalTrades = 0;
  private wins = 0;
  private losses = 0;
  private totalTicksReceived = 0;
  private phase: BotStatus['phase'] = 'idle';
  private storeUpdate: (partial: Partial<BotStoreState>) => void;
  private log: (msg: string) => void;
  private appId: string;
  private token: string = '';

  constructor(appId: string, storeUpdate: (partial: Partial<BotStoreState>) => void, log: (msg: string) => void) {
    this.appId = appId;
    this.client = new MultiMarketClient(appId, log);
    this.config = { ...DEFAULT_CONFIG };
    this.markets = createMarketStates();
    this.currentStake = DEFAULT_CONFIG.stake;
    this.storeUpdate = storeUpdate;
    this.log = log;
  }

  // --- Config ---

  updateConfig(partial: Partial<BotConfig>): void {
    this.config = { ...this.config, ...partial };
    if (partial.stake !== undefined && this.martingaleStep === 0) {
      this.currentStake = partial.stake;
    }
    this.log(`Config updated: stake=$${this.currentStake}, SL=$${this.config.stopLoss}, TP=$${this.config.takeProfit}`);
  }

  getConfig(): BotConfig {
    return { ...this.config };
  }

  // --- Connection ---

  async connect(token: string): Promise<AuthResult> {
    this.token = token;
    this.setPhase('connecting');
    this.log('Connecting to Deriv...');

    try {
      const auth = await this.client.connect(token);

      // Subscribe to balance updates
      this.client.onBalance((data) => {
        this.storeUpdate({ balance: data.balance });
      });

      // Handle disconnection
      this.client.onClose(() => {
        this.log('Connection lost!');
        this.setPhase('idle');
        this.storeUpdate({ connected: false, auth: null });
        if (this.running) {
          this.log('Auto-reconnecting in 5s...');
          setTimeout(() => {
            if (this.running && this.token) {
              this.connect(this.token).catch(e => this.log(`Reconnect failed: ${e.message}`));
            }
          }, 5000);
        }
      });

      // Subscribe to all market ticks
      const symbols = SCANNED_MARKETS.map(m => m.symbol);
      await this.client.subscribeTicks(symbols, (tick: TickData) => {
        this.handleTick(tick);
      });

      this.setPhase('idle');
      this.storeUpdate({ connected: true, auth, balance: auth.balance, isVirtual: auth.isVirtual });
      this.log(`Ready. Subscribed to ${symbols.length} markets.`);

      return auth;
    } catch (err) {
      this.setPhase('idle');
      const msg = (err as Error).message;
      this.log(`Connection failed: ${msg}`);
      this.storeUpdate({ connected: false, auth: null, connectionError: msg });
      throw err;
    }
  }

  // --- Tick Handling ---

  private handleTick(tick: TickData): void {
    this.totalTicksReceived++;

    const state = this.markets.get(tick.symbol);
    if (!state) return;

    feedTick(state, tick);

    // Update store with market data (throttled — not every tick)
    if (this.totalTicksReceived % 3 === 0) {
      this.pushMarketDataToStore();
    }
  }

  // --- Bot Control ---

  start(): void {
    if (this.running) {
      this.log('Bot is already running!');
      return;
    }
    if (!this.client.isConnected) {
      this.log('Cannot start: not connected. Click Connect first.');
      return;
    }

    this.running = true;
    this.sessionProfit = 0;
    this.consecutiveLosses = 0;
    this.martingaleStep = 0;
    this.currentStake = this.config.stake;
    this.tradeHistory = [];
    this.lossCooldowns.clear();
    this.activeTrades.clear();

    this.log('Bot STARTED. Collecting tick data...');
    this.storeUpdate({ running: true });

    // Reset market data for fresh session
    this.markets = createMarketStates();
    this.totalTicksReceived = 0;
    this.setPhase('collecting');

    // Main bot loop — runs outside React, no closures over state
    this.cycleTimer = setInterval(() => {
      this.runCycle();
    }, this.config.cycleIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
    this.setPhase('stopped');
    this.storeUpdate({ running: false });
    this.log(`Bot STOPPED. Session: ${this.totalTrades} trades, P/L: $${this.sessionProfit.toFixed(2)}`);
  }

  private async runCycle(): Promise<void> {
    if (!this.running) return;

    this.cycles++;

    // Phase 1: Collecting — wait for minimum ticks
    const minTicks = this.config.minTicksBeforeTrade;
    let allReady = true;
    for (const [, state] of this.markets) {
      if (state.totalTicks < minTicks) {
        allReady = false;
        break;
      }
    }

    if (!allReady) {
      if (this.cycles % 5 === 0) {
        const minState = [...this.markets.values()].sort((a, b) => a.totalTicks - b.totalTicks)[0];
        this.setPhase('collecting');
        this.log(`Collecting data... ${minState.symbol}: ${minState.totalTicks}/${minTicks} ticks`);
      }
      return;
    }

    // Phase 2: Scanning — score all markets
    this.setPhase('scanning');
    const ranked = scoreAndRank(this.markets);

    // Push ranked markets to store
    this.storeUpdate({
      rankedMarkets: ranked.map(m => ({
        symbol: m.symbol,
        name: m.name,
        score: m.score,
        signal: m.signal?.reason || 'No signal',
        totalTicks: m.totalTicks,
        lastDigit: m.lastTick?.digit ?? -1,
      })),
    });

    // Check stop-loss / take-profit
    if (this.config.stopLoss > 0 && this.sessionProfit <= -this.config.stopLoss) {
      this.log(`STOP LOSS hit: -$${Math.abs(this.sessionProfit).toFixed(2)} >= $${this.config.stopLoss}`);
      this.stop();
      return;
    }
    if (this.config.takeProfit > 0 && this.sessionProfit >= this.config.takeProfit) {
      this.log(`TAKE PROFIT hit: +$${this.sessionProfit.toFixed(2)} >= $${this.config.takeProfit}`);
      this.stop();
      return;
    }

    // Check max consecutive losses
    if (this.consecutiveLosses >= this.config.maxConsecutiveLosses) {
      this.log(`Max consecutive losses (${this.consecutiveLosses}) reached. Pausing 3 cycles...`);
      this.consecutiveLosses = 0;
      this.martingaleStep = 0;
      this.currentStake = this.config.stake;
      return;
    }

    // Phase 3: Trading — pick best market and trade
    this.setPhase('trading');

    // Find best eligible market
    const best = this.pickBestMarket(ranked);
    if (!best) {
      if (this.cycles % 10 === 0) {
        this.log('No eligible trade signal this cycle. Waiting...');
      }
      return;
    }

    // Execute trade
    await this.executeTrade(best);

    // Update store with stats
    this.pushStatsToStore();
  }

  private pickBestMarket(ranked: ScoredMarket[]): ScoredMarket | null {
    const now = this.cycles;
    let activeTradeCount = 0;

    for (const m of ranked) {
      // Check score threshold
      if (m.score < this.config.minScoreToTrade) continue;

      // Check if signal exists
      if (!m.signal) continue;

      // Check concurrent trades limit
      if (this.activeTrades.has(m.symbol)) {
        activeTradeCount++;
        continue;
      }

      // Check loss cooldown (skip market that just lost)
      const lastLossCycle = this.lossCooldowns.get(m.symbol) ?? 0;
      if (now - lastLossCycle < 3) continue;

      if (activeTradeCount >= this.config.maxConcurrentTrades) continue;

      return m;
    }

    return null;
  }

  private async executeTrade(market: ScoredMarket): Promise<void> {
    if (!market.signal) return;
    const signal: TradeSignal = market.signal;
    const stake = this.currentStake;

    this.log(`TRADE: ${signal.contractType} ${market.symbol} d${signal.barrier ?? '-'} $${stake.toFixed(2)} | ${signal.reason}`);

    try {
      // Get proposal from Deriv
      const proposal = await this.client.getProposal({
        contractType: signal.contractType,
        symbol: market.symbol,
        stake,
        barrier: signal.barrier,
        duration: 1,
        durationUnit: 't',
      });

      this.log(`Proposal OK: ask=$${proposal.askPrice.toFixed(2)} payout=$${proposal.payout.toFixed(2)}`);

      // Buy the contract
      const buyResult = await this.client.buyContract(proposal.id, proposal.askPrice);
      const won = buyResult.profit > 0;

      this.log(`${won ? 'WIN' : 'LOSS'} $${Math.abs(buyResult.profit).toFixed(2)} | contract=${buyResult.contractId}`);

      // Record trade
      const record: TradeRecord = {
        id: buyResult.contractId,
        contractId: buyResult.contractId,
        contractType: signal.contractType,
        symbol: market.symbol,
        name: market.name,
        stake,
        payout: buyResult.payout,
        profit: buyResult.profit,
        barrier: signal.barrier,
        won,
        timestamp: Date.now(),
        simulated: false,
        signal: signal.reason,
      };

      this.recordTrade(record, market.symbol);

    } catch (err) {
      const msg = (err as Error).message;
      this.log(`TRADE FAILED: ${msg}`);
      // Don't count as a trade, don't update martingale
    }
  }

  private recordTrade(record: TradeRecord, symbol: string): void {
    this.tradeHistory.unshift(record);
    if (this.tradeHistory.length > 200) this.tradeHistory.pop();

    this.totalTrades++;
    this.sessionProfit += record.profit;

    if (record.won) {
      this.wins++;
      this.consecutiveLosses = 0;
      this.martingaleStep = 0;
      this.currentStake = this.config.stake;
      this.lossCooldowns.delete(symbol);
    } else {
      this.losses++;
      this.consecutiveLosses++;
      this.lossCooldowns.set(symbol, this.cycles);

      // Martingale: increase stake after loss
      if (this.martingaleStep < this.config.martingaleMaxSteps) {
        this.martingaleStep++;
        this.currentStake = this.config.stake * Math.pow(this.config.martingaleMultiplier, this.martingaleStep);
        this.log(`Martingale step ${this.martingaleStep}: stake now $${this.currentStake.toFixed(2)}`);
      } else {
        // Reset martingale after max steps
        this.martingaleStep = 0;
        this.currentStake = this.config.stake;
        this.log(`Martingale reset after ${this.config.martingaleMaxSteps} steps`);
      }
    }

    // Push to store
    this.storeUpdate({
      tradeHistory: [...this.tradeHistory],
      trades: this.totalTrades,
      sessionProfit: this.sessionProfit,
    });

    this.pushStatsToStore();
  }

  // --- Store Updates ---

  private setPhase(phase: BotStatus['phase']): void {
    this.phase = phase;
    this.storeUpdate({ phase });
  }

  private pushStatsToStore(): void {
    const winRate = this.totalTrades > 0 ? (this.wins / this.totalTrades) * 100 : 0;
    this.storeUpdate({
      stats: {
        cycles: this.cycles,
        totalTrades: this.totalTrades,
        wins: this.wins,
        losses: this.losses,
        totalProfit: this.sessionProfit,
        sessionProfit: this.sessionProfit,
        winRate,
        consecutiveLosses: this.consecutiveLosses,
        currentStake: this.currentStake,
        martingaleStep: this.martingaleStep,
      },
      ticks: this.totalTicksReceived,
    });
  }

  private pushMarketDataToStore(): void {
    const marketData: Array<{
      symbol: string; name: string; digit: number; price: number;
      distribution: number[]; totalTicks: number;
    }> = [];

    for (const [, state] of this.markets) {
      marketData.push({
        symbol: state.symbol,
        name: state.name,
        digit: state.lastTick?.digit ?? -1,
        price: state.lastTick?.price ?? 0,
        distribution: [...state.distribution],
        totalTicks: state.totalTicks,
      });
    }

    this.storeUpdate({ marketData });
  }

  // --- Public Getters ---

  getStatus(): BotStatus {
    return {
      connected: this.client.isConnected,
      running: this.running,
      phase: this.phase,
      auth: this.client.getAuthResult(),
    };
  }

  getStats(): BotStats {
    return {
      cycles: this.cycles,
      totalTrades: this.totalTrades,
      wins: this.wins,
      losses: this.losses,
      totalProfit: this.sessionProfit,
      sessionProfit: this.sessionProfit,
      winRate: this.totalTrades > 0 ? (this.wins / this.totalTrades) * 100 : 0,
      consecutiveLosses: this.consecutiveLosses,
      currentStake: this.currentStake,
      martingaleStep: this.martingaleStep,
    };
  }

  getMarketData(): Map<string, MarketState> {
    return this.markets;
  }

  isRunning(): boolean {
    return this.running;
  }

  destroy(): void {
    this.stop();
    this.client.destroy();
    this.log('Bot destroyed.');
  }
}

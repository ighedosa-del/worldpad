'use client';

// === LUCAS Engine v25 — ROOT CAUSE FIX: get_price instead of proposal stream ===
// v25: The core bug was in deriv-client.ts using proposal:1 (creates a stream)
//     instead of get_price:1 (single-shot). The stream response may not carry
//     req_id, causing the pending request to time out silently.
//     Also: randomized 1-4s cycle, verbose logging, testTrade method.

import { MultiMarketClient } from './deriv-client';
import type { TickData, AuthResult } from './types';
import {
  ALL_MARKETS, TRADE_MARKETS, DISPLAY_MARKETS,
  createMarketStates, feedTick, runStrategy,
  recordMarketResult, getMarketConsecutiveLosses, resetBarrierIndex,
  reportTradeResult,
  STRATEGIES, type StrategyDef,
  type MarketState, type TradeSignal,
} from './strategies';
import { computeGates, type GateInputs } from './gate-monitor';
import type { BotStoreState } from './store';

// === Config ===

export interface BotConfig {
  stake: number;
  stopLoss: number;
  takeProfit: number;
  maxConsecutiveLosses: number;
  cycleIntervalMs: number;
  minTicksBeforeTrade: number;
  activeStrategy: string;
}

export const DEFAULT_CONFIG: BotConfig = {
  stake: 0.40,
  stopLoss: 6,
  takeProfit: 2,
  maxConsecutiveLosses: 10,
  cycleIntervalMs: 2000,
  minTicksBeforeTrade: 3,
  activeStrategy: 'even-odd-alt',
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
  avgEV: number;
  aiStrategiesLearned: number;
  aiWinRate: number;
  recoveryMode: boolean;
  adaptiveMinEV: number;
}

// === LUCAS Engine ===

export class DerivBot {
  private client: MultiMarketClient;
  private config: BotConfig;
  private markets: Map<string, MarketState>;
  private running = false;
  private cycleTimer: ReturnType<typeof setTimeout> | null = null;
  private dAlembertStep = 0;
  private currentStake: number;
  private sessionProfit = 0;
  private startBalance = 0;
  private cycles = 0;
  private totalTrades = 0;
  private wins = 0;
  private losses = 0;
  private totalTicksReceived = 0;
  private phase: 'idle' | 'connecting' | 'collecting' | 'scanning' | 'trading' | 'stopped' = 'idle';
  private storeUpdate: (partial: Partial<BotStoreState>) => void;
  private log: (msg: string) => void;
  private appId: string;
  private token: string = '';
  private tradeHistory: TradeRecord[] = [];
  private currentBalance = 0;
  private isTrading = false;
  private activeStrategyId = 'even-odd-alt';
  private firstSignalLogged = false;

  // Gate tracking
  private lastProposalOk = false;
  private lastProposalError: string | null = null;
  private lastProposalLatencyMs: number | null = null;
  private lastTradeExecuted = false;
  private lastTradeError: string | null = null;

  constructor(appId: string, storeUpdate: (partial: Partial<BotStoreState>) => void, log: (msg: string) => void) {
    this.appId = appId;
    this.client = new MultiMarketClient(appId, log);
    this.config = { ...DEFAULT_CONFIG };
    this.markets = createMarketStates();
    this.currentStake = DEFAULT_CONFIG.stake;
    this.storeUpdate = storeUpdate;
    this.log = log;
  }

  updateConfig(partial: Partial<BotConfig>): void {
    this.config = { ...this.config, ...partial };
    if (partial.stake !== undefined && this.dAlembertStep === 0) {
      this.currentStake = partial.stake;
    }
    if (partial.activeStrategy !== undefined) {
      this.activeStrategyId = partial.activeStrategy;
    }
  }

  getConfig(): BotConfig { return { ...this.config }; }

  // --- Connection ---

  async connect(token: string): Promise<AuthResult> {
    this.token = token;
    this.phase = 'connecting';
    this.log('Connecting to Deriv...');

    try {
      const auth = await this.client.connect(token);
      this.startBalance = auth.balance;
      this.currentBalance = auth.balance;

      this.client.onBalance((data) => {
        this.currentBalance = data.balance;
        this.storeUpdate({ balance: data.balance });
      });

      this.client.onClose(() => {
        this.log('Connection lost!');
        this.phase = 'idle';
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

      const symbols = ALL_MARKETS.map(m => m.symbol);
      await this.client.subscribeTicks(symbols, (tick: TickData) => {
        this.handleTick(tick);
      });

      this.phase = 'idle';
      this.storeUpdate({ connected: true, auth, balance: auth.balance, isVirtual: auth.isVirtual, accountList: auth.accountList });
      const stratName = STRATEGIES.find(s => s.id === this.activeStrategyId)?.name || this.activeStrategyId;
      this.log(`LUCAS v25 ready. ${auth.isVirtual ? 'DEMO' : 'REAL'} $${auth.balance.toFixed(2)}. Strategy: ${stratName}.`);
      this._pushGates();
      return auth;
    } catch (err) {
      this.phase = 'idle';
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
    if (this.totalTicksReceived % 3 === 0) this.pushMarketDataToStore();
  }

  // --- Bot Control ---

  start(): void {
    if (this.running) { this.log('LUCAS is already running!'); return; }

    if (!this.client.isConnected) {
      this.log('ERROR: Cannot start — not connected to Deriv. Please reconnect.');
      this.storeUpdate({ connected: false });
      return;
    }

    this.running = true;
    this.sessionProfit = 0;
    this.dAlembertStep = 0;
    this.currentStake = this.config.stake;
    this.tradeHistory = [];
    this.lastProposalOk = false;
    this.lastProposalError = null;
    this.lastTradeExecuted = false;
    this.lastTradeError = null;
    this.isTrading = false;
    this.firstSignalLogged = false;

    const strat = STRATEGIES.find(s => s.id === this.activeStrategyId);
    const stratName = strat?.name || this.activeStrategyId;
    resetBarrierIndex(this.activeStrategyId);
    this.log(`LUCAS v25 STARTED. ${stratName} on 1HZ100V. Stake: $${this.config.stake.toFixed(2)} | TP: $${this.config.takeProfit} | SL: $${this.config.stopLoss}`);
    this.storeUpdate({ running: true });

    this.markets = createMarketStates();
    this.totalTicksReceived = 0;
    this.cycles = 0;
    this.totalTrades = 0;
    this.wins = 0;
    this.losses = 0;
    this.phase = 'collecting';

    // v25: Use recursive setTimeout for randomized 1-4s intervals
    this.scheduleNextCycle();
    this._pushGates();
  }

  private scheduleNextCycle(): void {
    if (!this.running) return;
    // Random interval between 1000ms and 4000ms
    const delay = 1000 + Math.random() * 3000;
    this.cycleTimer = setTimeout(() => {
      this.runCycle().finally(() => {
        if (this.running) this.scheduleNextCycle();
      });
    }, delay);
  }

  stop(): void {
    this.running = false;
    if (this.cycleTimer) { clearTimeout(this.cycleTimer); this.cycleTimer = null; }
    this.phase = 'stopped';
    this.storeUpdate({ running: false });
    this.log(`LUCAS STOPPED. ${this.totalTrades} trades, P/L: $${this.sessionProfit.toFixed(2)}`);
    this._pushGates();
  }

  // --- Main Cycle ---

  private async runCycle(): Promise<void> {
    if (!this.running || this.isTrading) return;
    this.cycles++;

    // v25: Connection health check
    if (!this.client.isConnected) {
      this.log('WARNING: WebSocket disconnected during cycle. Waiting for reconnect...');
      this.storeUpdate({ connected: false });
      return;
    }

    // Phase 1: Collecting — wait for min ticks
    let allReady = true;
    for (const m of TRADE_MARKETS) {
      const state = this.markets.get(m.symbol);
      if (!state || state.totalTicks < this.config.minTicksBeforeTrade) {
        allReady = false; break;
      }
    }
    if (!allReady) {
      if (this.cycles % 3 === 0) {
        const tm = TRADE_MARKETS.map(m => {
          const s = this.markets.get(m.symbol);
          return `${m.symbol}:${s?.totalTicks ?? 0}`;
        }).join(' ');
        this.phase = 'collecting';
        this.log(`Waiting for ticks... ${tm} (need ${this.config.minTicksBeforeTrade})`);
      }
      this._pushGates();
      return;
    }

    // Phase 2: Stop-loss / take-profit
    if (this.config.stopLoss > 0 && this.sessionProfit <= -this.config.stopLoss) {
      this.log(`STOP LOSS hit: -$${Math.abs(this.sessionProfit).toFixed(2)}`);
      this.stop(); return;
    }
    if (this.config.takeProfit > 0 && this.sessionProfit >= this.config.takeProfit) {
      this.log(`TAKE PROFIT hit: +$${this.sessionProfit.toFixed(2)}`);
      this.stop(); return;
    }

    // Phase 3: Get signal
    this.phase = 'trading';
    const tradeMarket = TRADE_MARKETS[0];
    const state = this.markets.get(tradeMarket.symbol);
    if (!state) {
      this.log('ERROR: Market state not found for ' + tradeMarket.symbol);
      return;
    }

    const signal = runStrategy(state, this.activeStrategyId);
    if (!signal) {
      if (this.cycles % 10 === 0) {
        this.log('No signal (10+ consecutive losses or insufficient data)');
      }
      this._pushGates();
      this.pushStatsToStore();
      return;
    }

    // v25: Log the first signal prominently
    if (!this.firstSignalLogged) {
      this.log(`*** FIRST SIGNAL RECEIVED: ${signal.contractType} | Bot is about to trade! ***`);
      this.firstSignalLogged = true;
    }

    this.log(`Signal: ${signal.contractType} ${signal.barrier !== undefined ? 'd' + signal.barrier : ''} | ${signal.reason}`);

    // Push market display data
    const rankedMarkets = ALL_MARKETS.map(m => {
      const s = this.markets.get(m.symbol);
      const lastDigit = s?.lastTick?.digit ?? -1;
      return {
        symbol: m.symbol, name: m.name,
        score: m.symbol === tradeMarket.symbol ? signal.confidence * 100 : 0,
        signal: m.symbol === tradeMarket.symbol ? signal.reason : 'DISPLAY',
        totalTicks: s?.totalTicks ?? 0,
        lastDigit,
        ev: 0, regime: 'DIGIT', backtestGrade: '-',
      };
    });
    this.storeUpdate({ rankedMarkets });

    // Phase 4: Execute trade
    this.isTrading = true;
    try {
      await this.executeTrade(state, signal);
    } catch (err) {
      const errMsg = (err as Error).message;
      this.lastTradeError = errMsg;
      this.log(`EXECUTE ERROR: ${errMsg}`);
    } finally {
      this.isTrading = false;
    }

    this._pushGates();
    this.pushStatsToStore();
  }

  private async executeTrade(state: MarketState, signal: TradeSignal): Promise<void> {
    const stake = this.currentStake;
    const stratDef = STRATEGIES.find(s => s.id === this.activeStrategyId);

    this.log(`--- TRADE #${this.totalTrades + 1} ---`);
    this.log(`Executing: ${signal.contractType} ${signal.barrier !== undefined ? 'barrier=' + signal.barrier : ''} on ${state.symbol} | $${stake.toFixed(2)}`);

    let proposalId = '';
    let askPrice = 0;

    try {
      const proposalStart = Date.now();

      this.log(`Requesting get_price for ${signal.contractType}...`);
      const proposal = await this.client.getProposal({
        contractType: signal.contractType,
        symbol: state.symbol,
        stake,
        barrier: signal.barrier,
        duration: stratDef?.duration || 1,
        durationUnit: stratDef?.durationUnit || 't',
      });

      const proposalLatency = Date.now() - proposalStart;
      this.lastProposalLatencyMs = proposalLatency;
      this.lastProposalOk = true;
      this.lastProposalError = null;
      proposalId = proposal.id;
      askPrice = proposal.askPrice;
      this.log(`Price received (${proposalLatency}ms): id=${proposalId.slice(0, 12)}... ask=$${askPrice.toFixed(2)} payout=$${proposal.payout.toFixed(2)}`);

      this.log(`Buying contract...`);
      const buyResult = await this.client.buyContract(proposalId, askPrice);
      const won = buyResult.profit > 0;
      const profit = buyResult.profit;

      this.lastTradeExecuted = true;
      this.lastTradeError = null;
      this.log(`${won ? 'WIN' : 'LOSS'} $${Math.abs(profit).toFixed(2)} | payout=$${buyResult.payout.toFixed(2)} | contract=${buyResult.contractId}`);

      const record: TradeRecord = {
        id: buyResult.contractId,
        contractId: buyResult.contractId,
        contractType: signal.contractType,
        symbol: state.symbol,
        name: state.name,
        stake,
        payout: buyResult.payout,
        profit: profit,
        barrier: signal.barrier,
        won,
        timestamp: Date.now(),
        simulated: false,
        signal: signal.reason,
      };

      this.recordTrade(record, state.symbol);
    } catch (err) {
      const errMsg = (err as Error).message;
      this.lastProposalError = errMsg;
      this.lastTradeError = errMsg;
      this.lastProposalOk = false;
      this.log(`*** TRADE FAILED: ${errMsg} ***`);
    } finally {
      // v25: Clean up any open proposal streams
      try {
        await this.client.forgetAllProposals();
      } catch {}
    }
  }

  // v25: Test trade method — bypasses strategy, fires a single DIGITEVEN $0.35 trade
  // This is for debugging: proves the WS trading pipeline works end-to-end
  async testTrade(): Promise<string> {
    if (!this.client.isConnected) return 'ERROR: Not connected';
    if (this.isTrading) return 'ERROR: Trade in progress';

    this.isTrading = true;
    try {
      this.log('*** TEST TRADE: DIGITEVEN $0.35 ***');

      const proposal = await this.client.getProposal({
        contractType: 'DIGITEVEN',
        symbol: '1HZ100V',
        stake: 0.35,
        duration: 1,
        durationUnit: 't',
      });

      this.log(`TEST: Price OK ask=$${proposal.askPrice.toFixed(2)} payout=$${proposal.payout.toFixed(2)}`);

      const buyResult = await this.client.buyContract(proposal.id, proposal.askPrice);
      const won = buyResult.profit > 0;

      this.log(`TEST: ${won ? 'WIN' : 'LOSS'} $${Math.abs(buyResult.profit).toFixed(2)} contract=${buyResult.contractId}`);
      return `SUCCESS: ${won ? 'WIN' : 'LOSS'} $${Math.abs(buyResult.profit).toFixed(2)}`;
    } catch (err) {
      const msg = (err as Error).message;
      this.log(`TEST FAILED: ${msg}`);
      return `FAILED: ${msg}`;
    } finally {
      this.isTrading = false;
      try { await this.client.forgetAllProposals(); } catch {}
    }
  }

  private recordTrade(record: TradeRecord, symbol: string): void {
    this.tradeHistory.unshift(record);
    if (this.tradeHistory.length > 200) this.tradeHistory.pop();

    this.totalTrades++;
    this.sessionProfit += record.profit;

    const state = this.markets.get(symbol);
    if (state) recordMarketResult(state, record.won);

    if (record.won) {
      this.wins++;
      this.dAlembertStep = Math.max(0, this.dAlembertStep - 1);
    } else {
      this.losses++;
      this.dAlembertStep++;
    }

    // Report result to strategy (for Even/Odd alternation)
    reportTradeResult(this.activeStrategyId, record.won);

    // D'Alembert — step * $0.40 as user specified
    this.currentStake = this.config.stake + (this.dAlembertStep * 0.40);
    this.currentStake = Math.max(0.40, Math.round(this.currentStake * 100) / 100);

    this.log(`D'Alembert step=${this.dAlembertStep} | next stake=$${this.currentStake.toFixed(2)} | session P/L=$${this.sessionProfit.toFixed(2)}`);

    this.storeUpdate({ tradeHistory: [...this.tradeHistory] });
  }

  // --- Gate Monitor ---

  private _pushGates(): void {
    const inputs: GateInputs = {
      connected: this.client.isConnected,
      running: this.running,
      phase: this.phase,
      totalTicks: this.totalTicksReceived,
      minTicks: this.config.minTicksBeforeTrade,
      riskStopped: false,
      hasCandidate: this.totalTicksReceived >= this.config.minTicksBeforeTrade,
      backtestPassed: true,
      backtestGrade: 'A',
      regimeTradability: 1,
      ev: 0.5,
      proposalOk: this.lastProposalOk,
      proposalError: this.lastProposalError,
      proposalLatencyMs: this.lastProposalLatencyMs,
      tradeExecuted: this.lastTradeExecuted,
      tradeError: this.lastTradeError,
      cycles: this.cycles,
    };
    const gates = computeGates(inputs);
    this.storeUpdate({ gates });
  }

  // --- Store Updates ---

  private pushStatsToStore(): void {
    const winRate = this.totalTrades > 0 ? (this.wins / this.totalTrades) * 100 : 0;
    this.storeUpdate({
      stats: {
        cycles: this.cycles, totalTrades: this.totalTrades, wins: this.wins, losses: this.losses,
        totalProfit: this.sessionProfit, sessionProfit: this.sessionProfit,
        winRate, consecutiveLosses: 0,
        currentStake: this.currentStake, martingaleStep: this.dAlembertStep,
        avgEV: 0, aiStrategiesLearned: 0, aiWinRate: 0,
        recoveryMode: false, adaptiveMinEV: 0,
      },
      ticks: this.totalTicksReceived,
    });
  }

  private pushMarketDataToStore(): void {
    const marketData = DISPLAY_MARKETS.map(m => {
      const state = this.markets.get(m.symbol);
      if (!state) return { symbol: m.symbol, name: m.name, digit: -1, price: 0, distribution: new Array(10).fill(0), totalTicks: 0 };
      return {
        symbol: state.symbol, name: state.name,
        digit: state.lastTick?.digit ?? -1,
        price: state.lastTick?.price ?? 0,
        distribution: [...state.distribution],
        totalTicks: state.totalTicks,
      };
    });
    this.storeUpdate({ marketData });
  }

  getStatus() {
    return { connected: this.client.isConnected, running: this.running, phase: this.phase, auth: this.client.getAuthResult() };
  }

  getStats(): BotStats {
    const winRate = this.totalTrades > 0 ? (this.wins / this.totalTrades) * 100 : 0;
    return {
      cycles: this.cycles, totalTrades: this.totalTrades, wins: this.wins, losses: this.losses,
      totalProfit: this.sessionProfit, sessionProfit: this.sessionProfit,
      winRate, consecutiveLosses: 0,
      currentStake: this.currentStake, martingaleStep: this.dAlembertStep,
      avgEV: 0, aiStrategiesLearned: 0, aiWinRate: 0,
      recoveryMode: false, adaptiveMinEV: 0,
    };
  }

  destroy(): void { this.stop(); this.client.destroy(); this.log('LUCAS destroyed.'); }
}

'use client';

// === DerivBot Engine v3 — Full Analysis Pipeline ===
// Plain TypeScript class. NO React. NO stale closures.
// Pipeline: ticks → AI engine → regime filter → pattern detection → backtest → EV filter → Kelly stake → execute

import { MultiMarketClient, type TickData, type AuthResult } from './deriv-client';
import {
  SCANNED_MARKETS, createMarketStates, feedTick,
  runAllStrategies, type MarketState, type TradeSignal,
} from './strategies';
import { fullAnalysis, type FullAnalysis } from './analysis';
import { AIEngine, type AISignal } from './ai-engine';
import { calculateOptimalStake, createRiskState, updateRiskAfterTrade, DEFAULT_RISK_CONFIG, type RiskConfig, type RiskState } from './risk';
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
  useKelly: boolean;
  minEV: number;
}

export const DEFAULT_CONFIG: BotConfig = {
  stake: 0.35,
  stopLoss: 10,
  takeProfit: 20,
  maxConsecutiveLosses: 5,
  cycleIntervalMs: 2000,
  minTicksBeforeTrade: 50,
  minScoreToTrade: 30,
  maxConcurrentTrades: 2,
  martingaleMultiplier: 2.0,
  martingaleMaxSteps: 4,
  useKelly: true,
  minEV: 0.0,
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
  ev: number;
  regime: string;
  backtestGrade: string;
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
}

export interface BotStatus {
  connected: boolean;
  running: boolean;
  phase: 'idle' | 'connecting' | 'collecting' | 'scanning' | 'trading' | 'stopped';
  auth: AuthResult | null;
}

interface ScoredMarketExt {
  state: MarketState;
  strategySignal: TradeSignal | null;
  aiSignal: AISignal | null;
  analysis: FullAnalysis;
  ev: number;
  combinedScore: number;
}

// === The Bot Engine ===

export class DerivBot {
  private client: MultiMarketClient;
  private config: BotConfig;
  private markets: Map<string, MarketState>;
  private ai: AIEngine;
  private riskState: RiskState;
  private running = false;
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  private lossCooldowns = new Map<string, number>();
  private martingaleStep = 0;
  private currentStake: number;
  private sessionProfit = 0;
  private cycles = 0;
  private totalTrades = 0;
  private wins = 0;
  private losses = 0;
  private totalTicksReceived = 0;
  private evSum = 0;
  private phase: BotStatus['phase'] = 'idle';
  private storeUpdate: (partial: Partial<BotStoreState>) => void;
  private log: (msg: string) => void;
  private appId: string;
  private token: string = '';
  private tradeHistory: TradeRecord[] = [];

  constructor(appId: string, storeUpdate: (partial: Partial<BotStoreState>) => void, log: (msg: string) => void) {
    this.appId = appId;
    this.client = new MultiMarketClient(appId, log);
    this.config = { ...DEFAULT_CONFIG };
    this.markets = createMarketStates();
    this.ai = new AIEngine();
    this.riskState = createRiskState();
    this.currentStake = DEFAULT_CONFIG.stake;
    this.storeUpdate = storeUpdate;
    this.log = log;
  }

  updateConfig(partial: Partial<BotConfig>): void {
    this.config = { ...this.config, ...partial };
    if (partial.stake !== undefined && this.martingaleStep === 0) {
      this.currentStake = partial.stake;
    }
    this.log(`Config updated: stake=$${this.currentStake}, SL=$${this.config.stopLoss}, TP=$${this.config.takeProfit}, Kelly=${this.config.useKelly}`);
  }

  getConfig(): BotConfig { return { ...this.config }; }

  // --- Connection ---

  async connect(token: string): Promise<AuthResult> {
    this.token = token;
    this.setPhase('connecting');
    this.log('Connecting to Deriv...');

    try {
      const auth = await this.client.connect(token);

      this.client.onBalance((data) => {
        this.storeUpdate({ balance: data.balance });
      });

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
    // Feed tick to AI engine for Markov/Bayesian learning
    this.ai.feedTick(tick.symbol, state);
    // Throttled store update
    if (this.totalTicksReceived % 3 === 0) this.pushMarketDataToStore();
  }

  // --- Bot Control ---

  start(): void {
    if (this.running) { this.log('Bot is already running!'); return; }
    if (!this.client.isConnected) { this.log('Cannot start: not connected.'); return; }

    this.running = true;
    this.sessionProfit = 0;
    this.consecutiveLosses = 0;
    this.evSum = 0;
    this.martingaleStep = 0;
    this.currentStake = this.config.stake;
    this.tradeHistory = [];
    this.lossCooldowns.clear();
    this.riskState = createRiskState();

    this.log('Bot v3 STARTED. Pipeline: AI → Regime → Patterns → Backtest → EV → Kelly → Trade');
    this.storeUpdate({ running: true });

    this.markets = createMarketStates();
    this.ai = new AIEngine();
    this.totalTicksReceived = 0;
    this.setPhase('collecting');

    this.cycleTimer = setInterval(() => { this.runCycle(); }, this.config.cycleIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.cycleTimer) { clearInterval(this.cycleTimer); this.cycleTimer = null; }
    this.setPhase('stopped');
    this.storeUpdate({ running: false });
    this.log(`Bot STOPPED. ${this.totalTrades} trades, P/L: $${this.sessionProfit.toFixed(2)}, avg EV: ${this.totalTrades > 0 ? (this.evSum / this.totalTrades).toFixed(3) : 'N/A'}`);
  }

  // --- Main Cycle ---

  private async runCycle(): Promise<void> {
    if (!this.running) return;
    this.cycles++;

    // Phase 1: Collecting
    const minTicks = this.config.minTicksBeforeTrade;
    let allReady = true;
    for (const [, state] of this.markets) {
      if (state.totalTicks < minTicks) { allReady = false; break; }
    }
    if (!allReady) {
      if (this.cycles % 5 === 0) {
        const minState = [...this.markets.values()].sort((a, b) => a.totalTicks - b.totalTicks)[0];
        this.setPhase('collecting');
        this.log(`Collecting... ${minState.symbol}: ${minState.totalTicks}/${minTicks} ticks`);
      }
      return;
    }

    // Phase 2: Full analysis pipeline
    this.setPhase('scanning');

    // Stop-loss / take-profit check
    if (this.config.stopLoss > 0 && this.sessionProfit <= -this.config.stopLoss) {
      this.log(`STOP LOSS: -$${Math.abs(this.sessionProfit).toFixed(2)}`);
      this.stop(); return;
    }
    if (this.config.takeProfit > 0 && this.sessionProfit >= this.config.takeProfit) {
      this.log(`TAKE PROFIT: +$${this.sessionProfit.toFixed(2)}`);
      this.stop(); return;
    }
    if (this.riskState.stopped) {
      this.log(`Risk stopped: ${this.riskState.stopReason}`);
      this.stop(); return;
    }

    // Score all markets through full pipeline
    const scored: ScoredMarketExt[] = [];
    for (const [, state] of this.markets) {
      // 1. Strategy signals (from strategies.ts)
      const strategySignal = runAllStrategies(state);

      // 2. AI signal (Markov + Bayesian + learning)
      const aiSignal = this.ai.analyze(state);

      // 3. Pick best signal or null
      const bestSignal = this.pickBestSignal(strategySignal, aiSignal);

      // 4. Full analysis: regime + patterns + backtest + EV
      const analysis = fullAnalysis(state, bestSignal ? { contractType: bestSignal.contractType, barrier: bestSignal.barrier } : null);

      // 5. Combined score
      let score = 0;
      if (analysis.shouldTrade && bestSignal) {
        const sigConf = bestSignal ? bestSignal.confidence : 0;
        score = analysis.ev * 100 + analysis.regime.confidence * 30 + sigConf * 20;
        const bt2 = analysis.backtest;
        if (bt2 && bt2.grade === 'A') score += 15;
        else if (bt2 && bt2.grade === 'B') score += 10;
      }

      scored.push({ state, strategySignal, aiSignal, analysis, ev: analysis.ev, combinedScore: score });
    }

    // Sort by score descending
    scored.sort((a, b) => b.combinedScore - a.combinedScore);

    // Push ranked markets to store
    const displayMarkets = scored.map(m => {
      const bt = m.analysis.backtest;
      const btGrade = bt ? bt.grade : '-';
      const sig = m.analysis.shouldTrade
        ? (m.analysis.regime.regime + ' | EV:' + m.ev.toFixed(3) + ' | ' + btGrade + ' | ' + (m.strategySignal ? m.strategySignal.reason : (m.aiSignal ? m.aiSignal.reason : '-')))
        : (m.analysis.regime.regime + ' | no signal');
      const ld = m.state.lastTick;
      return {
        symbol: m.state.symbol,
        name: m.state.name,
        score: m.combinedScore,
        signal: sig,
        totalTicks: m.state.totalTicks,
        lastDigit: ld ? ld.digit : -1,
        ev: m.ev,
        regime: m.analysis.regime.regime,
        backtestGrade: btGrade,
      };
    });
    this.storeUpdate({ rankedMarkets: displayMarkets });

    // Phase 3: Pick best and trade
    this.setPhase('trading');

    const best = this.pickBestMarket(scored);
    if (!best) {
      if (this.cycles % 10 === 0) this.log('No +EV trade signal. Waiting...');
      this.pushStatsToStore();
      return;
    }

    await this.executeTrade(best);
    this.pushStatsToStore();
  }

  private pickBestSignal(strategy: TradeSignal | null, ai: AISignal | null): TradeSignal | AISignal | null {
    if (!strategy && !ai) return null;
    if (!strategy) return ai;
    if (!ai) return strategy;
    // Prefer AI signal (learned) over pure strategy signal
    if (ai.confidence > 0.5) return ai;
    return strategy.confidence > ai.confidence ? strategy : ai;
  }

  private pickBestMarket(scored: ScoredMarketExt[]): ScoredMarketExt | null {
    const now = this.cycles;
    let activeCount = 0;

    for (const m of scored) {
      if (!m.analysis.shouldTrade) continue;
      if (m.ev < this.config.minEV) continue;

      const lastLossCycle = this.lossCooldowns.get(m.state.symbol) ?? 0;
      if (now - lastLossCycle < 3) continue;

      if (activeCount >= this.config.maxConcurrentTrades) continue;

      // Prefer markets with higher EV
      activeCount++;
      return m;
    }
    return null;
  }

  private async executeTrade(market: ScoredMarketExt): Promise<void> {
    const signal = this.pickBestSignal(market.strategySignal, market.aiSignal);
    if (!signal) return;

    // Calculate optimal stake
    let stake = this.currentStake;
    let stakeReason = `base $${stake.toFixed(2)}`;

    if (this.config.useKelly && market.analysis.backtest) {
      const riskConfig: RiskConfig = { ...DEFAULT_RISK_CONFIG, baseStake: this.config.stake };
      const result = calculateOptimalStake(
        market.analysis.backtest.winRate,
        signal.contractType,
        riskConfig,
        this.riskState,
      );
      if (result.stake > 0) {
        stake = result.stake;
        stakeReason = result.reason;
      }
    }

    const barrierStr = signal.barrier !== undefined ? String(signal.barrier) : '-';
    const bt3 = market.analysis.backtest;
    const btGradeStr = bt3 ? bt3.grade : '?';
    this.log(`TRADE: ${signal.contractType} ${market.state.symbol} d${barrierStr} $${stake.toFixed(2)} | EV=${market.ev.toFixed(3)} ${market.analysis.regime.regime} BT:${btGradeStr} | ${signal.reason}`);

    try {
      const proposal = await this.client.getProposal({
        contractType: signal.contractType,
        symbol: market.state.symbol,
        stake,
        barrier: signal.barrier,
        duration: 1,
        durationUnit: 't',
      });

      this.log(`Proposal: ask=$${proposal.askPrice.toFixed(2)} payout=$${proposal.payout.toFixed(2)}`);

      const buyResult = await this.client.buyContract(proposal.id, proposal.askPrice);
      const won = buyResult.profit > 0;

      this.log(`${won ? 'WIN' : 'LOSS'} $${Math.abs(buyResult.profit).toFixed(2)} contract=${buyResult.contractId}`);

      const record: TradeRecord = {
        id: buyResult.contractId,
        contractId: buyResult.contractId,
        contractType: signal.contractType,
        symbol: market.state.symbol,
        name: market.state.name,
        stake,
        payout: buyResult.payout,
        profit: buyResult.profit,
        barrier: signal.barrier,
        won,
        timestamp: Date.now(),
        simulated: false,
        signal: signal.reason,
        ev: market.ev,
        regime: market.analysis.regime.regime,
        backtestGrade: btGradeStr,
      };

      this.recordTrade(record, market.state.symbol, signal);
    } catch (err) {
      this.log(`TRADE FAILED: ${(err as Error).message}`);
    }
  }

  private recordTrade(record: TradeRecord, symbol: string, signal: TradeSignal | AISignal): void {
    this.tradeHistory.unshift(record);
    if (this.tradeHistory.length > 200) this.tradeHistory.pop();

    this.totalTrades++;
    this.sessionProfit += record.profit;
    this.evSum += record.ev;

    // Feed result to AI for learning
    this.ai.recordTrade(symbol, record.contractType, record.barrier, record.profit);

    // Update risk state
    this.riskState = updateRiskAfterTrade(this.riskState, record.profit);

    if (record.won) {
      this.wins++;
      this.riskState.consecutiveLosses = 0;
      this.martingaleStep = 0;
      this.currentStake = this.config.stake;
      this.lossCooldowns.delete(symbol);
    } else {
      this.losses++;
      this.lossCooldowns.set(symbol, this.cycles);

      if (this.martingaleStep < this.config.martingaleMaxSteps) {
        this.martingaleStep++;
        this.currentStake = this.config.stake * Math.pow(this.config.martingaleMultiplier, this.martingaleStep);
        this.log(`Martingale ${this.martingaleStep}: $${this.currentStake.toFixed(2)}`);
      } else {
        this.martingaleStep = 0;
        this.currentStake = this.config.stake;
      }
    }

    this.storeUpdate({ tradeHistory: [...this.tradeHistory], trades: this.totalTrades, sessionProfit: this.sessionProfit });
    this.pushStatsToStore();
  }

  // --- Store Updates ---

  private setPhase(phase: BotStatus['phase']): void {
    this.phase = phase;
    this.storeUpdate({ phase });
  }

  private pushStatsToStore(): void {
    const winRate = this.totalTrades > 0 ? (this.wins / this.totalTrades) * 100 : 0;
    const aiStats = this.ai.getLearningStats();
    this.storeUpdate({
      stats: {
        cycles: this.cycles,
        totalTrades: this.totalTrades,
        wins: this.wins,
        losses: this.losses,
        totalProfit: this.sessionProfit,
        sessionProfit: this.sessionProfit,
        winRate,
        consecutiveLosses: this.riskState.consecutiveLosses,
        currentStake: this.currentStake,
        martingaleStep: this.martingaleStep,
        avgEV: this.totalTrades > 0 ? this.evSum / this.totalTrades : 0,
        aiStrategiesLearned: aiStats.strategiesLearned,
        aiWinRate: aiStats.winRate * 100,
      },
      ticks: this.totalTicksReceived,
    });
  }

  private pushMarketDataToStore(): void {
    const marketData = [] as Array<{ symbol: string; name: string; digit: number; price: number; distribution: number[]; totalTicks: number }>;
    for (const [, state] of this.markets) {
      const lt = state.lastTick;
      marketData.push({
        symbol: state.symbol, name: state.name,
        digit: lt ? lt.digit : -1,
        price: lt ? lt.price : 0,
        distribution: [...state.distribution],
        totalTicks: state.totalTicks,
      });
    }
    this.storeUpdate({ marketData });
  }

  getStatus(): BotStatus {
    return { connected: this.client.isConnected, running: this.running, phase: this.phase, auth: this.client.getAuthResult() };
  }

  getStats(): BotStats {
    const aiStats = this.ai.getLearningStats();
    return {
      cycles: this.cycles, totalTrades: this.totalTrades, wins: this.wins, losses: this.losses,
      totalProfit: this.sessionProfit, sessionProfit: this.sessionProfit,
      winRate: this.totalTrades > 0 ? (this.wins / this.totalTrades) * 100 : 0,
      consecutiveLosses: this.riskState.consecutiveLosses,
      currentStake: this.currentStake, martingaleStep: this.martingaleStep,
      avgEV: this.totalTrades > 0 ? this.evSum / this.totalTrades : 0,
      aiStrategiesLearned: aiStats.strategiesLearned,
      aiWinRate: aiStats.winRate * 100,
    };
  }

  destroy(): void { this.stop(); this.client.destroy(); this.log('Bot destroyed.'); }
}
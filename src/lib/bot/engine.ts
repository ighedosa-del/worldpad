'use client';

import { derivClient, type TickData, type AuthorizeResult } from './deriv-client';

// === MARKETS ===
export const MARKETS = [
  { symbol: 'R_100', name: 'Vol 100' },
  { symbol: 'R_75', name: 'Vol 75' },
  { symbol: 'R_50', name: 'Vol 50' },
  { symbol: 'R_25', name: 'Vol 25' },
  { symbol: 'R_10', name: 'Vol 10' },
  { symbol: '1HZ100V', name: 'Vol 100 (1s)' },
  { symbol: '1HZ75V', name: 'Vol 75 (1s)' },
  { symbol: '1HZ50V', name: 'Vol 50 (1s)' },
  { symbol: '1HZ25V', name: 'Vol 25 (1s)' },
  { symbol: '1HZ10V', name: 'Vol 10 (1s)' },
] as const;

export interface TradeRecord {
  id: string;
  symbol: string;
  name: string;
  contractType: string;
  barrier: number | undefined;
  stake: number;
  payout: number;
  profit: number;
  buyPrice: number;
  contractId: string;
  won: boolean;
  timestamp: number;
}

export interface MarketState {
  symbol: string;
  name: string;
  digits: number[];
  distribution: number[];    // count per digit
  distributionPct: number[];  // percentage per digit
  lastTick: TickData | null;
  tickCount: number;
  lastTradeTime: number;
  onCooldown: boolean;
}

export type BotStatus = 'idle' | 'connecting' | 'scanning' | 'trading' | 'paused' | 'error';

export interface BotState {
  status: BotStatus;
  auth: AuthorizeResult | null;
  markets: Record<string, MarketState>;
  trades: TradeRecord[];
  totalProfit: number;
  totalTrades: number;
  wins: number;
  losses: number;
  currentCycle: number;
  logs: string[];
  stake: number;
  stopLoss: number;
  takeProfit: number;
  running: boolean;
}

// === DIGIT FREQUENCY BUFFER SIZE ===
const BUFFER_SIZE = 100;
const TRADE_COOLDOWN_MS = 5000; // 5s cooldown per market after a trade

/**
 * BotEngine — Plain TypeScript class. No React. No hooks. No closures.
 * Uses event callbacks to notify UI of state changes.
 */
export class BotEngine {
  private state: BotState;
  private cycleTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribers: (() => void)[] = [];
  private isDestroyed = false;

  // Callbacks for UI
  public onChange: ((state: BotState) => void) | null = null;

  constructor() {
    const markets: Record<string, MarketState> = {};
    for (const m of MARKETS) {
      markets[m.symbol] = {
        symbol: m.symbol,
        name: m.name,
        digits: [],
        distribution: new Array(10).fill(0),
        distributionPct: new Array(10).fill(0),
        lastTick: null,
        tickCount: 0,
        lastTradeTime: 0,
        onCooldown: false,
      };
    }
    this.state = {
      status: 'idle',
      auth: null,
      markets,
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
  }

  get stateSnapshot(): BotState {
    return { ...this.state };
  }

  private log(msg: string) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.state.logs.push(`[${ts}] ${msg}`);
    if (this.state.logs.length > 200) this.state.logs = this.state.logs.slice(-200);
    this.emit();
  }

  private emit() {
    if (!this.isDestroyed) this.onChange?.(this.stateSnapshot);
  }

  // === CONNECT ===
  async connect(token: string): Promise<AuthorizeResult> {
    this.setStatus('connecting');
    this.log('Connecting to Deriv...');

    // Wire up client callbacks
    derivClient.onLog = (msg) => this.log(msg.replace('[Deriv] ', ''));
    derivClient.onAuthChange = (auth) => {
      this.state.auth = auth;
      this.emit();
    };

    try {
      const result = await derivClient.connect(token);
      this.state.auth = result;
      this.setStatus('scanning');
      this.log(`Connected: ${result.loginid} | $${result.balance.toFixed(2)} ${result.currency} | ${result.accountType.toUpperCase()}`);

      // Subscribe to ticks for all markets
      for (const m of MARKETS) {
        const unsub = derivClient.subscribeTicks(m.symbol, (tick) => this.onTick(m.symbol, tick));
        this.unsubscribers.push(unsub);
      }

      // Subscribe to balance updates
      this.unsubscribers.push(derivClient.subscribeBalance((bal) => {
        if (this.state.auth) {
          this.state.auth = { ...this.state.auth, balance: bal };
          this.emit();
        }
      }));

      return result;
    } catch (err) {
      this.setStatus('error');
      this.log(`Connection failed: ${(err as Error).message}`);
      throw err;
    }
  }

  // === TICK HANDLING ===
  private onTick(symbol: string, tick: TickData) {
    const market = this.state.markets[symbol];
    if (!market) return;

    market.lastTick = tick;
    market.tickCount++;

    // Update digit buffer
    market.digits.push(tick.digit);
    if (market.digits.length > BUFFER_SIZE) market.digits.shift();

    // Recalculate distribution
    const dist = new Array(10).fill(0);
    for (const d of market.digits) dist[d]++;
    market.distribution = dist;
    const total = market.digits.length || 1;
    for (let i = 0; i < 10; i++) market.distributionPct[i] = (dist[i] / total) * 100;

    // Check cooldown expiry
    if (market.onCooldown && Date.now() - market.lastTradeTime > TRADE_COOLDOWN_MS) {
      market.onCooldown = false;
    }

    // Emit on every 5th tick to avoid excessive re-renders
    if (market.tickCount % 5 === 0) this.emit();
  }

  // === STRATEGY: Find least frequent digit, trade DIGITDIFF ===
  private pickTrade(): { symbol: string; name: string; barrier: number } | null {
    const now = Date.now();
    let bestSymbol = '';
    let bestName = '';
    let bestBarrier = 0;
    let bestPct = Infinity;
    let bestDeviation = 0;

    for (const m of MARKETS) {
      const market = this.state.markets[m.symbol];
      if (!market) continue;

      // Need at least 30 ticks for meaningful data
      if (market.tickCount < 30) continue;

      // Skip if on cooldown
      if (market.onCooldown) continue;

      // Find the least frequent digit
      let minPct = Infinity;
      let minDigit = 0;
      for (let i = 0; i < 10; i++) {
        if (market.distributionPct[i] < minPct) {
          minPct = market.distributionPct[i];
          minDigit = i;
        }
      }

      // Expected frequency is 10%. The further below, the better the signal.
      const deviation = 10 - minPct;
      if (deviation > bestDeviation && minPct < 12) { // Only trade if digit is below 12%
        bestDeviation = deviation;
        bestSymbol = m.symbol;
        bestName = m.name;
        bestBarrier = minDigit;
        bestPct = minPct;
      }
    }

    if (!bestSymbol) return null;
    return { symbol: bestSymbol, name: bestName, barrier: bestBarrier };
  }

  // === PLACE A REAL TRADE ===
  private async placeTrade(symbol: string, name: string, barrier: number, stake: number): Promise<void> {
    const market = this.state.markets[symbol];
    if (!market) throw new Error(`Unknown market: ${symbol}`);

    this.log(`${name}: DIGITDIFF d${barrier} @ $${stake.toFixed(2)} [REAL]`);

    // 1. Get proposal
    const proposal = await derivClient.getProposal({
      symbol,
      contractType: 'DIGITDIFF',
      stake,
      barrier,
      duration: 1,
      durationUnit: 't',
    });

    // 2. Buy contract
    const buy = await derivClient.buyContract(proposal.id, proposal.askPrice);
    const won = buy.profit > 0;

    // 3. Record
    market.lastTradeTime = Date.now();
    market.onCooldown = true;

    const trade: TradeRecord = {
      id: `T-${Date.now()}-${symbol}`,
      symbol,
      name,
      contractType: 'DIGITDIFF',
      barrier,
      stake,
      payout: buy.payout,
      profit: buy.profit,
      buyPrice: buy.buyPrice,
      contractId: buy.contractId,
      won,
      timestamp: Date.now(),
    };

    this.state.trades.unshift(trade);
    if (this.state.trades.length > 100) this.state.trades = this.state.trades.slice(0, 100);
    this.state.totalTrades++;
    this.state.totalProfit += buy.profit;
    if (won) this.state.wins++; else this.state.losses++;

    this.log(won
      ? `WIN ${name}: +$${buy.profit.toFixed(2)} | W:${this.state.wins} L:${this.state.losses}`
      : `LOSS ${name}: -$${Math.abs(buy.profit).toFixed(2)} | W:${this.state.wins} L:${this.state.losses} | contract=${buy.contractId}`
    );

    this.emit();
  }

  // === MAIN BOT LOOP ===
  private async runCycle() {
    if (!this.state.running || this.isDestroyed) return;

    try {
      // Check stop-loss
      if (this.state.stopLoss > 0 && this.state.totalProfit <= -this.state.stopLoss) {
        this.log(`STOP LOSS HIT: -$${Math.abs(this.state.totalProfit).toFixed(2)} exceeded $${this.state.stopLoss} limit`);
        this.stop();
        return;
      }

      // Check take-profit
      if (this.state.takeProfit > 0 && this.state.totalProfit >= this.state.takeProfit) {
        this.log(`TAKE PROFIT HIT: +$${this.state.totalProfit.toFixed(2)} reached $${this.state.takeProfit} target`);
        this.stop();
        return;
      }

      this.setStatus('trading');
      this.state.currentCycle++;

      // Pick best trade
      const pick = this.pickTrade();
      if (!pick) {
        const readyMarkets = MARKETS.filter(m => this.state.markets[m.symbol].tickCount >= 30).length;
        this.setStatus('scanning');
        // Don't log every cycle — too noisy
        return;
      }

      // Execute the trade
      await this.placeTrade(pick.symbol, pick.name, pick.barrier, this.state.stake);

    } catch (err) {
      this.log(`Cycle error: ${(err as Error).message}`);
    }

    // Schedule next cycle (3 seconds)
    if (this.state.running && !this.isDestroyed) {
      this.cycleTimer = setTimeout(() => this.runCycle(), 3000);
    }
  }

  // === PUBLIC CONTROLS ===
  start() {
    if (this.state.running) return;

    // Reset session stats
    this.state.totalProfit = 0;
    this.state.totalTrades = 0;
    this.state.wins = 0;
    this.state.losses = 0;
    this.state.currentCycle = 0;
    this.state.running = true;

    this.log('═══════════════════════════════════════');
    this.log(`BOT STARTED | Stake: $${this.state.stake.toFixed(2)} | Stop: -$${this.state.stopLoss} | Target: +$${this.state.takeProfit}`);
    this.log('═══════════════════════════════════════');

    this.emit();
    // Start the loop after a short delay for initial tick data
    this.cycleTimer = setTimeout(() => this.runCycle(), 1000);
  }

  stop() {
    this.state.running = false;
    if (this.cycleTimer) { clearTimeout(this.cycleTimer); this.cycleTimer = null; }
    this.setStatus('idle');
    this.log(`BOT STOPPED | Trades: ${this.state.totalTrades} | P/L: ${this.state.totalProfit >= 0 ? '+' : ''}$${this.state.totalProfit.toFixed(2)} | W:${this.state.wins} L:${this.state.losses}`);
    this.emit();
  }

  setStake(v: number) { this.state.stake = Math.max(0.35, v); this.emit(); }
  setStopLoss(v: number) { this.state.stopLoss = v; this.emit(); }
  setTakeProfit(v: number) { this.state.takeProfit = v; this.emit(); }

  private setStatus(s: BotStatus) {
    this.state.status = s;
    this.emit();
  }

  destroy() {
    this.isDestroyed = true;
    this.stop();
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    derivClient.disconnect();
  }
}

// Singleton
export const botEngine = new BotEngine();

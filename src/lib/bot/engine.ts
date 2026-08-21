'use client';

import { derivClient, type TickData, type AuthorizeResult } from './deriv-client';

export const MARKETS = [
  { symbol: 'R_100', name: 'Volatility 100', type: 'STD' },
  { symbol: 'R_75', name: 'Volatility 75', type: 'STD' },
  { symbol: 'R_50', name: 'Volatility 50', type: 'STD' },
  { symbol: 'R_25', name: 'Volatility 25', type: 'STD' },
  { symbol: 'R_10', name: 'Volatility 10', type: 'STD' },
  { symbol: '1HZ100V', name: 'Vol 100 (1s)', type: '1s' },
  { symbol: '1HZ75V', name: 'Vol 75 (1s)', type: '1s' },
  { symbol: '1HZ50V', name: 'Vol 50 (1s)', type: '1s' },
  { symbol: '1HZ25V', name: 'Vol 25 (1s)', type: '1s' },
 { symbol: '1HZ10V', name: 'Vol 10 (1s)', type: '1s' },
] as const;

export interface TradeRecord {
  id: string; symbol: string; name: string; contractType: string; barrier: number | undefined;
  stake: number; payout: number; profit: number; buyPrice: number; contractId: string; won: boolean; timestamp: number; accountId: string; }

export interface MarketState {
  symbol: string; name: string; type: string; digits: number[]; distribution: number[]; distributionPct: number[]; lastTick: TickData | null; tickCount: number; lastTradeTime: number; onCooldown: boolean; }

export type BotStatus = 'idle' | 'connecting' | 'scanning' | 'trading' | 'paused' | 'error';

export interface StoredAccount {
  id: string; label: string; token: string; accountType: 'demo' | 'real'; loginid: string; balance: number; currency: string; }

export interface BotConfig { stake: number; stopLoss: number; takeProfit: number; cooldownMs: number; minBuffer: number; }

export interface BotSnapshot {
  status: BotStatus;
  activeAccountId: string | null;
  activeAuth: AuthorizeResult | null;
  accounts: StoredAccount[];
  markets: Record<string, MarketState>;
  trades: TradeRecord[];
  totalProfit: number;
  totalTrades: number;
  wins: number;
  losses: number;
  cycles: number;
  logs: string[];
  config: BotConfig;
  running: boolean;
  totalTicks: number;
}

const BUFFER_SIZE = 100;
const DEFAULT_CONFIG: BotConfig = { stake: 0.35, stopLoss: 10, takeProfit: 50, cooldownMs: 5000, minBuffer: 30 };

export class BotEngine {
  private state: BotSnapshot;
  private cycleTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubs: (() => void)[] = [];
  private destroyed = false;
  public onChange: ((s: BotSnapshot) => void) | null = null;

  constructor() {
    const markets: Record<string, MarketState> = {};
    for (const m of MARKETS) markets[m.symbol] = { symbol: m.symbol, name: m.name, type: m.type, digits: [], distribution: new Array(10).fill(0), distributionPct: new Array(10).fill(0), lastTick: null, tickCount: 0, lastTradeTime: 0, onCooldown: false };
    this.state = { status: 'idle', activeAccountId: null, activeAuth: null, accounts: [], markets, trades: [], totalProfit: 0, totalTrades: 0, wins: 0, losses: 0, cycles: 0, logs: [], config: { ...DEFAULT_CONFIG }, running: false, totalTicks: 0 };
  }

  get snapshot(): BotSnapshot { return { ...this.state }; }

  private log(msg: string) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.state.logs.push(`[${ts}] ${msg}`);
    if (this.state.logs.length > 300) this.state.logs = this.state.logs.slice(-300);
    this.emit();
  }

  private emit() { if (!this.destroyed) this.onChange?.(this.snapshot()); }
  private setStatus(s: BotStatus) { this.state.status = s; this.emit(); }

  // === ACCOUNT MANAGEMENT ===

  async addAccount(token: string): Promise<StoredAccount> {
    this.log('Verifying token...');
    const tempClient = new (await import('./deriv-client')).DerivClient();
    tempClient.onLog = (m) => this.log(m.replace('[WS] ', ''));
    const auth = await tempClient.connect(token);
    tempClient.disconnect();
    const account: StoredAccount = { id: auth.loginid, label: `${auth.accountType.toUpperCase()} ${auth.loginid}`, token, accountType: auth.accountType, loginid: auth.loginid, balance: auth.balance, currency: auth.currency };
    // Don't duplicate
    this.state.accounts = this.state.accounts.filter(a => a.id !== account.id);
    this.state.accounts.push(account);
    this.emit();
    this.log(`Account added: ${account.label} | $${account.balance.toFixed(2)} ${account.currency}`);
    return account;
  }

  removeAccount(id: string) {
    if (this.state.running && this.state.activeAccountId === id) this.stop();
    this.state.accounts = this.state.accounts.filter(a => a.id !== id);
    if (this.state.activeAccountId === id) { this.state.activeAccountId = null; this.state.activeAuth = null; }
    this.emit();
  }

  async switchAccount(id: string) {
    if (this.state.running) this.stop();
    const account = this.state.accounts.find(a => a.id === id);
    if (!account) throw new Error('Account not found');
    this.log(`Switching to ${account.label}...`);
    await this.connectWithAccount(account);
  }

  async connectWithAccount(account: StoredAccount): Promise<void> {
    this.setStatus('connecting');
    this.cleanup();
    // Wire client
    derivClient.onLog = (m) => this.log(m.replace('[WS] ', ''));
    derivClient.onAuthChange = (auth) => { this.state.activeAuth = auth; this.emit(); };
    try {
      const auth = await derivClient.connect(account.token);
      this.state.activeAccountId = account.id;
      this.state.activeAuth = auth;
      // Update stored balance
      const acc = this.state.accounts.find(a => a.id === account.id);
      if (acc) { acc.balance = auth.balance; }
      this.setStatus('scanning');
      // Subscribe ticks
      for (const m of MARKETS) this.unsubs.push(derivClient.subscribeTicks(m.symbol, (tick) => this.onTick(m.symbol, tick)));
      this.unsubs.push(derivClient.subscribeBalance((bal) => { if (this.state.activeAuth) { this.state.activeAuth = { ...this.state.activeAuth, balance: bal }; this.emit(); } }));
      this.log(`Connected: ${auth.loginid} | $${auth.balance.toFixed(2)} ${auth.currency} | ${auth.accountType.toUpperCase()}`);
    } catch (err) {
      this.setStatus('error');
      this.log(`Connection failed: ${(err as Error).message}`);
      throw err;
    }
  }

  // === TICKS ===

  private onTick(symbol: string, tick: TickData) {
    const m = this.state.markets[symbol]; if (!m) return;
    m.lastTick = tick; m.tickCount++;
    m.digits.push(tick.digit);
    if (m.digits.length > BUFFER_SIZE) m.digits.shift();
    const dist = new Array(10).fill(0); for (const d of m.digits) dist[d]++;
    m.distribution = dist;
    const total = m.digits.length || 1; for (let i = 0; i < 10; i++) m.distributionPct[i] = (dist[i] / total) * 100;
    if (m.onCooldown && Date.now() - m.lastTradeTime > this.state.config.cooldownMs) m.onCooldown = false;
    this.state.totalTicks++;
    if (m.tickCount % 10 === 0) this.emit();
  }

  // === STRATEGY ===

  private pickTrade(): { symbol: string; name: string; barrier: number; deviation: number } | null {
    let bestSymbol = '', bestName = '', bestBarrier = 0, bestDev = 0;
    for (const mk of MARKETS) {
      const m = this.state.markets[mk.symbol]; if (!m || m.tickCount < this.state.config.minBuffer || m.onCooldown) continue;
      let minPct = Infinity, minD = 0;
      for (let i = 0; i < 10; i++) { if (m.distributionPct[i] < minPct) { minPct = m.distributionPct[i]; minD = i; } }
      const dev = 10 - minPct;
      if (dev > bestDev && minPct < 12) { bestDev = dev; bestSymbol = mk.symbol; bestName = mk.name; bestBarrier = minD; }
    }
    return bestSymbol ? { symbol: bestSymbol, name: bestName, barrier: bestBarrier, deviation: bestDev } : null;
  }

  private async placeTrade(symbol: string, name: string, barrier: number, stake: number): Promise<void> {
    this.log(`${name}: DIGITDIFF d${barrier} @ $${stake.toFixed(2)}`);
    const proposal = await derivClient.getProposal({ symbol, contractType: 'DIGITDIFF', stake, barrier, duration: 1, durationUnit: 't' });
    const buy = await derivClient.buyContract(proposal.id, proposal.askPrice);
    const won = buy.profit > 0;
    const market = this.state.markets[symbol]; if (market) { market.lastTradeTime = Date.now(); market.onCooldown = true; }
    const trade: TradeRecord = { id: `T-${Date.now()}`, symbol, name, contractType: 'DIGITDIFF', barrier, stake, payout: buy.payout, profit: buy.profit, buyPrice: buy.buyPrice, contractId: buy.contractId, won, timestamp: Date.now(), accountId: this.state.activeAccountId || '' };
    this.state.trades.unshift(trade); if (this.state.trades.length > 100) this.state.trades = this.state.trades.slice(0, 100);
    this.state.totalTrades++; this.state.totalProfit += buy.profit;
    if (won) this.state.wins++; else this.state.losses++;
    this.log(won ? `WIN ${name}: +$${buy.profit.toFixed(2)} | W:${this.state.wins} L:${this.state.losses}` : `LOSS ${name}: -$${Math.abs(buy.profit).toFixed(2)} | W:${this.state.wins} L:${this.state.losses} | ${buy.contractId}`);
    this.emit();
  }

  // === BOT LOOP ===

  private async runCycle() {
    if (!this.state.running || this.destroyed) return;
    try {
      if (this.state.config.stopLoss > 0 && this.state.totalProfit <= -this.state.config.stopLoss) { this.log(`STOP LOSS: -$${Math.abs(this.state.totalProfit).toFixed(2)}`); this.stop(); return; }
      if (this.state.config.takeProfit > 0 && this.state.totalProfit >= this.state.config.takeProfit) { this.log(`TAKE PROFIT: +$${this.state.totalProfit.toFixed(2)}`); this.stop(); return; }
      this.setStatus('trading'); this.state.cycles++;
      const pick = this.pickTrade();
      if (!pick) { this.setStatus('scanning'); return; }
      await this.placeTrade(pick.symbol, pick.name, pick.barrier, this.state.config.stake);
    } catch (err) { this.log(`Error: ${(err as Error).message}`); }
    if (this.state.running && !this.destroyed) this.cycleTimer = setTimeout(() => this.runCycle(), 3000);
  }

  // === CONTROLS ===

  start() {
    if (this.state.running) return;
    this.state.totalProfit = 0; this.state.totalTrades = 0; this.state.wins = 0; this.state.losses = 0; this.state.cycles = 0; this.state.running = true;
    this.log('═══════════════════════════════════');
    this.log(`BOT STARTED | $${this.state.config.stake.toFixed(2)} | SL -$${this.state.config.stopLoss} | TP +$${this.state.config.takeProfit} | ${this.state.activeAuth?.accountType.toUpperCase() || 'N/A'}`);
    this.log('═══════════════════════════════════');
    this.emit();
    this.cycleTimer = setTimeout(() => this.runCycle(), 2000);
  }

  stop() {
    this.state.running = false; if (this.cycleTimer) { clearTimeout(this.cycleTimer); this.cycleTimer = null; }
    this.setStatus('idle');
    this.log(`STOPPED | ${this.state.totalTrades} trades | ${this.state.totalProfit >= 0 ? '+' : ''}$${this.state.totalProfit.toFixed(2)} | W:${this.state.wins} L:${this.state.losses}`);
  }

  setConfig(c: Partial<BotConfig>) { this.state.config = { ...this.state.config, ...c }; this.emit(); }

  private cleanup() { if (this.cycleTimer) { clearTimeout(this.cycleTimer); this.cycleTimer = null; } for (const u of this.unsubs) u(); this.unsubs = []; }

  destroy() { this.destroyed = true; this.stop(); this.cleanup(); derivClient.disconnect(); }
}

export const botEngine = new BotEngine();

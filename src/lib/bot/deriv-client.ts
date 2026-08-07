'use client';

/**
 * DerivClient — Clean WebSocket client for Deriv API.
 * Supports: auth, proposals, buy, tick subscriptions, reconnection,
 * and multi-account switching (disconnect + reconnect with different token).
 */

const DERIV_WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';

export interface AuthorizeResult {
  loginid: string;
  fullname: string;
  balance: number;
  currency: string;
  isVirtual: boolean;
  accountType: 'demo' | 'real';
}

export interface ProposalResult { id: string; askPrice: number; payout: number; }
export interface BuyResult { contractId: string; buyPrice: number; payout: number; profit: number; }
export interface TickData { symbol: string; quote: number; epoch: number; digit: number; }

export interface AccountInfo {
  id: string;
  label: string;
  token: string;
  auth: AuthorizeResult | null;
  isOnline: boolean;
}

export class DerivClient {
  private ws: WebSocket | null = null;
  private reqId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private tickHandlers = new Map<string, Set<(tick: TickData) => void>>();
  private balanceHandlers = new Set<(balance: number) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _closed = false;
  private _authResolve: ((v: AuthorizeResult) => void) | null = null;
  private _authReject: ((e: Error) => void) | null = null;
  private _authTimer: ReturnType<typeof setTimeout> | null = null;

  public authorized = false;
  public token = '';
  public authResult: AuthorizeResult | null = null;
  public onLog: ((msg: string) => void) | null = null;
  public onAuthChange: ((auth: AuthorizeResult | null) => void) | null = null;

  private log(msg: string) { this.onLog?.(`[WS] ${msg}`); console.log(`[DerivClient] ${msg}`); }

  async connect(token: string): Promise<AuthorizeResult> {
    this.token = token;
    this._closed = false;
    this.cleanupPending();
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    this.authorized = false;
    this.authResult = null;
    return this.doConnect();
  }

  private doConnect(): Promise<AuthorizeResult> {
    return new Promise((resolve, reject) => {
      if (this._closed) { reject(new Error('Client closed')); return; }
      this._authResolve = resolve;
      this._authReject = reject;
      this._authTimer = setTimeout(() => { this._authResolve = null; this._authReject = null; reject(new Error('Connection timeout (10s)')); }, 10000);
      try { this.ws = new WebSocket(DERIV_WS_URL); } catch { reject(new Error('Cannot create WebSocket')); return; }
      this.ws.onopen = () => { this.log('Connected, authorizing...'); this.ws!.send(JSON.stringify({ authorize: this.token })); };
      this.ws.onmessage = (e) => { try { this.handleMessage(JSON.parse(e.data)); } catch (err) { console.error(err); } };
      this.ws.onclose = (ev) => { this.handleClose(ev); };
      this.ws.onerror = () => { clearTimeout(this._authTimer); console.error('[DerivClient] WS error'); };
    });
  }

  private handleMessage(data: any) {
    if (data.msg_type === 'authorize') {
      clearTimeout(this._authTimer!);
      this._authResolve = null; this._authReject = null;
      if (data.error) { this.log(`Auth FAILED: ${data.error.message}`); this._authReject?.(new Error(data.error.message)); return; }
      this.authorized = true;
      this.authResult = { loginid: data.authorize.loginid, fullname: data.authorize.fullname || '', balance: parseFloat(data.authorize.balance) || 0, currency: data.authorize.currency || 'USD', isVirtual: data.authorize.is_virtual, accountType: data.authorize.is_virtual ? 'demo' : 'real' };
      this.log(`Authorized: ${this.authResult.loginid} | $${this.authResult.balance.toFixed(2)} ${this.authResult.currency} | ${this.authResult.accountType.toUpperCase()}`);
      this.onAuthChange?.(this.authResult);
      return;
    }
    if (data.req_id !== undefined && this.pending.has(data.req_id)) {
      const p = this.pending.get(data.req_id)!; clearTimeout(p.timer); this.pending.delete(data.req_id);
      data.error ? p.reject(new Error(data.error.message || 'API error')) : p.resolve(data);
      return;
    }
    if (data.msg_type === 'tick' && data.tick) {
      const q = data.tick.quote.toString(); const tick: TickData = { symbol: data.tick.symbol, quote: parseFloat(q), epoch: data.tick.epoch, digit: parseInt(q[q.length - 1], 10) };
      this.tickHandlers.get(data.tick.symbol)?.forEach(h => h(tick));
    }
    if (data.msg_type === 'balance' && data.balance) {
      const bal = parseFloat(data.balance.balance) || 0;
      if (this.authResult) this.authResult.balance = bal;
      this.balanceHandlers.forEach(h => h(bal));
    }
  }

  private handleClose(ev: CloseEvent) {
    clearTimeout(this._authTimer!);
    this.authorized = false; this.authResult = null; this.onAuthChange?.(null);
    this.cleanupPending();
    if (!this._closed && this.token) { this.log('Reconnecting in 3s...'); this.reconnectTimer = setTimeout(() => { this.doConnect().catch(e => this.log(`Reconnect: ${e.message}`)); }, 3000); }
  }

  private cleanupPending() {
    if (this._authTimer) { clearTimeout(this._authTimer); this._authTimer = null; }
    this._authResolve = null; this._authReject = null;
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('WS closed')); this.pending.delete(id); }
  }

  private request(msg: Record<string, unknown>, ms = 10000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { reject(new Error('WS not open')); return; }
      if (!this.authorized) { reject(new Error('Not authorized')); return; }
      const id = this.reqId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Timeout')); }, ms);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ ...msg, req_id: id }));
    });
  }

  async getProposal(p: { symbol: string; contractType: string; stake: number; barrier?: number; duration?: number; durationUnit?: string; }): Promise<ProposalResult> {
    const payload: Record<string, unknown> = { proposal: 1, amount: p.stake, basis: 'stake', contract_type: p.contractType, symbol: p.symbol, duration: p.duration || 1, duration_unit: p.durationUnit || 't', currency: 'USD' };
    if (p.barrier !== undefined) payload.barrier = p.barrier.toString();
    const d = await this.request(payload, 5000); if (!d.proposal) throw new Error(d.error?.message || 'No proposal');
    return { id: d.proposal.id, askPrice: parseFloat(d.proposal.ask_price) || 0, payout: parseFloat(d.proposal.payout) || 0 };
  }

  async buyContract(proposalId: string, askPrice: number): Promise<BuyResult> {
    const d = await this.request({ buy: proposalId, price: askPrice }, 10000); if (!d.buy) throw new Error(d.error?.message || 'Buy failed');
    return { contractId: d.buy.contract_id?.toString() || '', buyPrice: parseFloat(d.buy.buy_price) || 0, payout: parseFloat(d.buy.payout) || 0, profit: parseFloat(d.buy.profit) || 0 };
  }

  subscribeTicks(symbol: string, handler: (tick: TickData) => void): () => void {
    if (!this.tickHandlers.has(symbol)) this.tickHandlers.set(symbol, new Set());
    this.tickHandlers.get(symbol)!.add(handler);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    return () => { this.tickHandlers.get(symbol)?.delete(handler); };
  }

  subscribeBalance(handler: (balance: number) => void): () => void {
    this.balanceHandlers.add(handler);
    if (this.ws?.readyState === WebSocket.OPEN && this.authorized) this.ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
    return () => { this.balanceHandlers.delete(handler); };
  }

  disconnect() {
    this._closed = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.cleanupPending();
    this.authorized = false; this.authResult = null; this.onAuthChange?.(null);
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    this.tickHandlers.clear(); this.balanceHandlers.clear();
  }

  get isReady(): boolean { return this.ws?.readyState === WebSocket.OPEN && this.authorized; }
}

export const derivClient = new DerivClient();

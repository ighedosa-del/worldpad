'use client';

/**
 * DerivClient — Clean WebSocket client for Deriv API.
 * No React, no hooks, no closures. Just a class.
 * Handles: auth, proposals, buy, tick subscriptions, reconnection.
 */

const DERIV_WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';

type MessageHandler = (data: any) => void;

export interface AuthorizeResult {
  loginid: string;
  fullname: string;
  balance: number;
  currency: string;
  isVirtual: boolean;
  accountType: 'demo' | 'real';
}

export interface ProposalResult {
  id: string;
  askPrice: number;
  payout: number;
}

export interface BuyResult {
  contractId: string;
  buyPrice: number;
  payout: number;
  profit: number;
}

export interface TickData {
  symbol: string;
  quote: number;
  epoch: number;
  digit: number;
}

export class DerivClient {
  private ws: WebSocket | null = null;
  private reqId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private tickHandlers = new Map<string, Set<(tick: TickData) => void>>();
  private balanceHandlers = new Set<(balance: number) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _closed = false;
  
  public authorized = false;
  public token = '';
  public authResult: AuthorizeResult | null = null;
  public onLog: ((msg: string) => void) | null = null;
  public onAuthChange: ((auth: AuthorizeResult | null) => void) | null = null;

  private log(msg: string) {
    this.onLog?.(`[Deriv] ${msg}`);
    console.log(`[DerivClient] ${msg}`);
  }

  async connect(token: string): Promise<AuthorizeResult> {
    this.token = token;
    this._closed = false;
    return this.doConnect();
  }

  private doConnect(): Promise<AuthorizeResult> {
    return new Promise((resolve, reject) => {
      if (this._closed) { reject(new Error('Client closed')); return; }

      // Close existing
      if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
      this.authorized = false;
      this.authResult = null;

      const timer = setTimeout(() => {
        reject(new Error('Connection timeout (10s)'));
      }, 10000);

      try {
        this.ws = new WebSocket(DERIV_WS_URL);
      } catch (e) {
        reject(new Error('Cannot create WebSocket'));
        return;
      }

      this.ws.onopen = () => {
        this.log('Connected, authorizing...');
        this.ws!.send(JSON.stringify({ authorize: this.token }));
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data, resolve, reject, timer);
        } catch (e) {
          console.error('[DerivClient] Parse error:', e);
        }
      };

      this.ws.onclose = (e) => {
        clearTimeout(timer);
        this.authorized = false;
        this.log(`Disconnected (code=${e.code})`);
        this.onAuthChange?.(null);
        // Reject all pending
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error('WebSocket closed'));
          this.pending.delete(id);
        }
        // Auto-reconnect
        if (!this._closed && this.token) {
          this.log('Reconnecting in 3s...');
          this.reconnectTimer = setTimeout(() => {
            this.doConnect().catch(err => this.log(`Reconnect failed: ${err.message}`));
          }, 3000);
        }
      };

      this.ws.onerror = () => {
        clearTimeout(timer);
        console.error('[DerivClient] WebSocket error');
      };
    });
  }

  private handleMessage(
    data: any,
    authResolve: (v: AuthorizeResult) => void,
    authReject: (e: Error) => void,
    authTimer: ReturnType<typeof setTimeout>,
  ) {
    // Authorize response
    if (data.msg_type === 'authorize') {
      clearTimeout(authTimer);
      if (data.error) {
        this.log(`Auth FAILED: ${data.error.message}`);
        authReject(new Error(data.error.message));
        return;
      }
      this.authorized = true;
      this.authResult = {
        loginid: data.authorize.loginid,
        fullname: data.authorize.fullname || '',
        balance: parseFloat(data.authorize.balance) || 0,
        currency: data.authorize.currency || 'USD',
        isVirtual: data.authorize.is_virtual,
        accountType: data.authorize.is_virtual ? 'demo' : 'real',
      };
      this.log(`Authorized: ${this.authResult.loginid} | $${this.authResult.balance.toFixed(2)} ${this.authResult.currency} | ${this.authResult.accountType.toUpperCase()}`);
      this.onAuthChange?.(this.authResult);
      authResolve(this.authResult);
      return;
    }

    // Pending request response (proposal, buy, etc.)
    if (data.req_id !== undefined && this.pending.has(data.req_id)) {
      const p = this.pending.get(data.req_id)!;
      clearTimeout(p.timer);
      this.pending.delete(data.req_id);
      if (data.error) {
        p.reject(new Error(data.error.message || 'API error'));
      } else {
        p.resolve(data);
      }
      return;
    }

    // Tick subscription
    if (data.msg_type === 'tick' && data.tick) {
      const quote = parseFloat(data.tick.quote);
      const quoteStr = data.tick.quote.toString();
      const digit = parseInt(quoteStr[quoteStr.length - 1], 10);
      const tick: TickData = {
        symbol: data.tick.symbol,
        quote,
        epoch: data.tick.epoch,
        digit,
      };
      const handlers = this.tickHandlers.get(data.tick.symbol);
      if (handlers) handlers.forEach(h => h(tick));
    }

    // Balance subscription
    if (data.msg_type === 'balance' && data.balance) {
      const bal = parseFloat(data.balance.balance) || 0;
      if (this.authResult) this.authResult.balance = bal;
      this.balanceHandlers.forEach(h => h(bal));
    }
  }

  private request(msg: Record<string, unknown>, timeoutMs = 10000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not open'));
        return;
      }
      if (!this.authorized) {
        reject(new Error('Not authorized'));
        return;
      }
      const id = this.reqId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Request timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ ...msg, req_id: id }));
    });
  }

  // === PUBLIC TRADE API ===

  async getProposal(params: {
    symbol: string;
    contractType: string;
    stake: number;
    barrier?: number;
    duration?: number;
    durationUnit?: string;
  }): Promise<ProposalResult> {
    const payload: Record<string, unknown> = {
      proposal: 1,
      amount: params.stake,
      basis: 'stake',
      contract_type: params.contractType,
      symbol: params.symbol,
      duration: params.duration || 1,
      duration_unit: params.durationUnit || 't',
      currency: 'USD',
    };
    if (params.barrier !== undefined) {
      payload.barrier = params.barrier.toString();
    }
    const data = await this.request(payload, 5000);
    if (!data.proposal) throw new Error(data.error?.message || 'No proposal');
    return {
      id: data.proposal.id,
      askPrice: parseFloat(data.proposal.ask_price) || 0,
      payout: parseFloat(data.proposal.payout) || 0,
    };
  }

  async buyContract(proposalId: string, askPrice: number): Promise<BuyResult> {
    const data = await this.request({ buy: proposalId, price: askPrice }, 10000);
    if (!data.buy) throw new Error(data.error?.message || 'Buy failed');
    return {
      contractId: data.buy.contract_id?.toString() || '',
      buyPrice: parseFloat(data.buy.buy_price) || 0,
      payout: parseFloat(data.buy.payout) || 0,
      profit: parseFloat(data.buy.profit) || 0,
    };
  }

  subscribeTicks(symbol: string, handler: (tick: TickData) => void): () => void {
    if (!this.tickHandlers.has(symbol)) this.tickHandlers.set(symbol, new Set());
    this.tickHandlers.get(symbol)!.add(handler);
    // Send subscription
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    }
    // Return unsubscribe
    return () => {
      this.tickHandlers.get(symbol)?.delete(handler);
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Note: we'd need to track sub IDs to forget. For simplicity, we just stop handling.
      }
    };
  }

  subscribeBalance(handler: (balance: number) => void): () => void {
    this.balanceHandlers.add(handler);
    if (this.ws?.readyState === WebSocket.OPEN && this.authorized) {
      this.ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
    }
    return () => { this.balanceHandlers.delete(handler); };
  }

  disconnect() {
    this._closed = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.authorized = false;
    this.authResult = null;
    this.onAuthChange?.(null);
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    this.pending.clear();
    this.tickHandlers.clear();
    this.balanceHandlers.clear();
  }

  get isReady(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.authorized;
  }
}

// Singleton
export const derivClient = new DerivClient();

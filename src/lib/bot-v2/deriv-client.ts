'use client';

// === DerivClient v2 — Pure TypeScript WebSocket client ===
// No React dependencies. No stale closures. Just WebSocket + promises.
// Single connection, multi-market tick subscriptions via multiple WS instances.

const WS_URL = 'wss://ws.derivws.com/websockets/v3';

type MsgHandler = (data: any) => void;

export interface AccountInfo {
  loginid: string;
  isVirtual: boolean;
  currency: string;
  balance?: number;
}

export interface AuthResult {
  loginid: string;
  fullname: string;
  balance: number;
  currency: string;
  isVirtual: boolean;
  scopes: string[];
  accountList: AccountInfo[];
}

export interface TickData {
  symbol: string;
  price: number;
  digit: number;
  epoch: number;
  timestamp: number;
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

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class DerivClient {
  private ws: WebSocket | null = null;
  private appId: string;
  private token: string = '';
  private authorized = false;
  private authResult: AuthResult | null = null;
  private reqId = 0;
  private pending = new Map<number, PendingRequest>();
  private tickHandlers = new Map<string, MsgHandler[]>();
  private balanceHandlers: MsgHandler[] = [];
  private closeHandlers: (() => void)[] = [];
  private openPromise: Promise<void> | null = null;
  private destroyed = false;

  constructor(appId: string) {
    this.appId = appId;
  }

  // --- Connection & Auth ---

  connect(token: string): Promise<AuthResult> {
    if (this.openPromise) return this.openPromise.then(() => this.authResult!);
    if (this.authorized && this.token === token) return Promise.resolve(this.authResult!);

    this.token = token;
    this.destroyed = false;

    this.openPromise = new Promise((resolve, reject) => {
      const url = `${WS_URL}?app_id=${this.appId}`;
      console.log('[DerivClient] Connecting to', url);

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        this.openPromise = null;
        reject(new Error('Cannot create WebSocket'));
        return;
      }
      this.ws = ws;

      const timer = setTimeout(() => {
        this.openPromise = null;
        reject(new Error('Connection timeout (15s)'));
      }, 15000);

      ws.onopen = () => {
        console.log('[DerivClient] WebSocket opened, sending authorize...');
        ws.send(JSON.stringify({ authorize: token }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (e) {
          console.error('[DerivClient] Parse error', e);
        }
      };

      ws.onclose = (event) => {
        console.log('[DerivClient] WS closed:', event.code, event.reason);
        clearTimeout(timer);
        const wasAuthed = this.authorized;
        this.authorized = false;
        this.openPromise = null;
        this.ws = null;
        this.rejectAllPending('WebSocket closed');
        if (!wasAuthed) {
          reject(new Error(`WebSocket closed before auth (code ${event.code})`));
        } else {
          this.closeHandlers.forEach(h => h());
        }
      };

      ws.onerror = () => {
        clearTimeout(timer);
        this.openPromise = null;
        reject(new Error('WebSocket connection error'));
      };

      // The actual auth result comes via handleMessage -> authorize
      // We store resolve/reject so handleMessage can call them
      this._authResolve = (result: AuthResult) => {
        clearTimeout(timer);
        this.authorized = true;
        this.authResult = result;
        console.log('[DerivClient] Authorized:', result.loginid, 'virtual:', result.isVirtual, 'balance:', result.balance);
        resolve(result);
      };
      this._authReject = (err: Error) => {
        clearTimeout(timer);
        this.openPromise = null;
        reject(err);
      };
    });

    return this.openPromise;
  }

  private _authResolve: ((result: AuthResult) => void) | null = null;
  private _authReject: ((err: Error) => void) | null = null;

  private handleMessage(data: any) {
    // Auth response
    if (data.msg_type === 'authorize') {
      if (data.error) {
        const errCode = data.error.code || '';
        const errMsg = data.error.message || 'Auth failed';
        const details = data.error.details || '';
        this._authReject?.(new Error(`[${errCode}] ${errMsg}${details ? ': ' + details : ''}`));
        return;
      }
      const a = data.authorize;
      const accountList: AccountInfo[] = (a.account_list || []).map((acc: any) => ({
        loginid: acc.loginid,
        isVirtual: !!acc.is_virtual,
        currency: acc.currency || 'USD',
        balance: acc.balance ? parseFloat(acc.balance) : undefined,
      }));
      this._authResolve?.({
        loginid: a.loginid,
        fullname: a.fullname || '',
        balance: parseFloat(a.balance) || 0,
        currency: a.currency || 'USD',
        isVirtual: !!a.is_virtual,
        scopes: a.scopes || [],
        accountList,
      });
      return;
    }

    // Pending request response (proposal, buy, etc.)
    if (data.req_id !== undefined && this.pending.has(data.req_id)) {
      const p = this.pending.get(data.req_id)!;
      this.pending.delete(data.req_id);
      clearTimeout(p.timer);
      if (data.error) {
        p.reject(new Error(data.error.message || 'API error'));
      } else {
        p.resolve(data);
      }
      return;
    }

    // Tick data
    if (data.msg_type === 'tick' && data.tick) {
      const handlers = this.tickHandlers.get(data.tick.symbol);
      if (handlers) {
        const priceStr = data.tick.quote.toString();
        const lastDigit = parseInt(priceStr[priceStr.length - 1], 10);
        const tick: TickData = {
          symbol: data.tick.symbol,
          price: parseFloat(data.tick.quote),
          digit: lastDigit,
          epoch: data.tick.epoch,
          timestamp: Date.now(),
        };
        handlers.forEach(h => h(tick));
      }
    }

    // Balance update
    if (data.msg_type === 'balance' && data.balance) {
      const bal = parseFloat(data.balance.balance);
      this.balanceHandlers.forEach(h => h({ balance: bal, loginid: data.balance.loginid }));
    }
  }

  private rejectAllPending(reason: string) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  // --- Tick Subscriptions ---

  onTick(symbol: string, handler: (tick: TickData) => void): () => void {
    if (!this.tickHandlers.has(symbol)) {
      this.tickHandlers.set(symbol, []);
      // Subscribe to ticks for this symbol
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
      }
    }
    const handlers = this.tickHandlers.get(symbol)!;
    handlers.push(handler);
    // Return unsubscribe function
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
      if (handlers.length === 0) {
        this.tickHandlers.delete(symbol);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          // We'd need sub_id to forget, but ticks don't always return sub_id easily
          // We'll just clear the handlers
        }
      }
    };
  }

  onBalance(handler: (data: { balance: number; loginid: string }) => void): () => void {
    this.balanceHandlers.push(handler);
    return () => {
      const idx = this.balanceHandlers.indexOf(handler);
      if (idx >= 0) this.balanceHandlers.splice(idx, 1);
    };
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.push(handler);
    return () => {
      const idx = this.closeHandlers.indexOf(handler);
      if (idx >= 0) this.closeHandlers.splice(idx, 1);
    };
  }

  // --- Trading ---

  async getProposal(params: {
    contractType: string;
    symbol: string;
    stake: number;
    barrier?: number;
    duration?: number;
    durationUnit?: string;
  }): Promise<ProposalResult> {
    this.ensureConnected();

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

    const data = await this.sendRequest(payload, 8000);
    if (!data.proposal) {
      throw new Error(data.error?.message || 'No proposal in response');
    }
    return {
      id: data.proposal.id,
      askPrice: parseFloat(data.proposal.ask_price) || 0,
      payout: parseFloat(data.proposal.payout) || 0,
    };
  }

  async buyContract(proposalId: string, askPrice: number): Promise<BuyResult> {
    this.ensureConnected();
    const data = await this.sendRequest({ buy: proposalId, price: askPrice }, 15000);
    if (!data.buy) {
      throw new Error(data.error?.message || 'Buy failed');
    }
    return {
      contractId: data.buy.contract_id?.toString() || '',
      buyPrice: parseFloat(data.buy.buy_price) || 0,
      payout: parseFloat(data.buy.payout) || 0,
      profit: parseFloat(data.buy.profit) || 0,
    };
  }

  subscribeBalance(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
    }
  }

  // --- Internal ---

  private ensureConnected() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    if (!this.authorized) {
      throw new Error('WebSocket not authorized');
    }
  }

  private sendRequest(msg: Record<string, unknown>, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      const reqId = ++this.reqId;
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error('Request timed out'));
      }, timeoutMs);
      this.pending.set(reqId, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ ...msg, req_id: reqId }));
    });
  }

  // --- Status ---

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.authorized;
  }

  getAuthResult(): AuthResult | null {
    return this.authResult;
  }

  destroy() {
    this.destroyed = true;
    this.authorized = false;
    this.authResult = null;
    this.openPromise = null;
    this.rejectAllPending('Client destroyed');
    this.tickHandlers.clear();
    this.balanceHandlers = [];
    this.closeHandlers = [];
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }
}

// === Multi-market client: one WS per market for parallel tick streams ===

export class MultiMarketClient {
  private clients: Map<string, DerivClient> = new Map();
  private appId: string;
  private token: string = '';
  private authResult: AuthResult | null = null;
  private _onLog: (msg: string) => void;

  constructor(appId: string, onLog: (msg: string) => void) {
    this.appId = appId;
    this._onLog = onLog;
  }

  async connect(token: string): Promise<AuthResult> {
    this.token = token;
    // Use first client for auth
    const primary = this.getOrCreateClient('primary');
    this.authResult = await primary.connect(token);
    this._onLog(`Connected: ${this.authResult.loginid} | ${this.authResult.isVirtual ? 'DEMO' : 'REAL'} | $${this.authResult.balance.toFixed(2)}`);
    return this.authResult;
  }

  private getOrCreateClient(symbol: string): DerivClient {
    let client = this.clients.get(symbol);
    if (!client) {
      client = new DerivClient(this.appId);
      this.clients.set(symbol, client);
    }
    return client;
  }

  async subscribeTicks(symbols: string[], onTick: (tick: TickData) => void): Promise<void> {
    if (!this.token) throw new Error('Not connected');

    // Use one shared WS for all tick subscriptions (single connection can handle multiple ticks)
    const primary = this.clients.get('primary');
    if (!primary) throw new Error('Primary client not initialized');

    for (const symbol of symbols) {
      primary.onTick(symbol, onTick);
      // Send tick subscription
      // onTick already handles subscribing when first handler is added
    }

    this._onLog(`Subscribed to ${symbols.length} markets: ${symbols.join(', ')}`);
  }

  async getProposal(params: {
    contractType: string;
    symbol: string;
    stake: number;
    barrier?: number;
  }): Promise<ProposalResult> {
    const primary = this.clients.get('primary');
    if (!primary) throw new Error('Not connected');
    return primary.getProposal(params);
  }

  async buyContract(proposalId: string, askPrice: number): Promise<BuyResult> {
    const primary = this.clients.get('primary');
    if (!primary) throw new Error('Not connected');
    return primary.buyContract(proposalId, askPrice);
  }

  onBalance(handler: (data: { balance: number; loginid: string }) => void): () => void {
    const primary = this.clients.get('primary');
    if (!primary) return () => {};
    return primary.onBalance(handler);
  }

  onClose(handler: () => void): () => void {
    const primary = this.clients.get('primary');
    if (!primary) return () => {};
    return primary.onClose(handler);
  }

  get isConnected(): boolean {
    const primary = this.clients.get('primary');
    return primary?.isConnected ?? false;
  }

  getAuthResult(): AuthResult | null {
    return this.authResult;
  }

  destroy() {
    for (const [, client] of this.clients) {
      client.destroy();
    }
    this.clients.clear();
    this.authResult = null;
  }
}

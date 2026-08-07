'use client';

// === DerivClient v4 — Pure WebSocket (same approach as deriv-ws.ts) ===
// REST API caused "Failed to fetch" errors.
// WebSocket authorize works with BOTH regular tokens AND PAT_ tokens.
// All operations (auth, proposal, buy, ticks, balance) go through a single WebSocket.

const WS_BASE = 'wss://ws.derivws.com/websockets/v3';

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

// === DerivClient ===

export class DerivClient {
  private ws: WebSocket | null = null;
  private appId: string;
  private token: string = '';
  private authorized = false;
  private authResult: AuthResult | null = null;
  private tickHandlers = new Map<string, MsgHandler[]>();
  private balanceHandlers: MsgHandler[] = [];
  private closeHandlers: (() => void)[] = [];
  private destroyed = false;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Promise-based request/response (same pattern as deriv-ws.ts)
  private reqIdCounter = 1;
  private pendingRequests = new Map<number, { resolve: (data: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(appId: string) {
    this.appId = appId;
  }

  // --- Connection & Auth via WebSocket ---

  async connect(token: string): Promise<AuthResult> {
    if (this.authorized && this.token === token) return this.authResult!;

    this.token = token;
    this.destroyed = false;

    return new Promise((resolve, reject) => {
      const url = `${WS_BASE}?app_id=${this.appId}`;
      console.log('[DerivClient] Connecting to', url);

      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        reject(new Error('Cannot create WebSocket'));
        return;
      }

      const timer = setTimeout(() => {
        reject(new Error('Connection timeout (15s)'));
      }, 15000);

      this.ws.onopen = () => {
        console.log('[DerivClient] WS opened, sending authorize...');
        // Authorize using the ORIGINAL simple method (works with PAT_ tokens)
        this.ws!.send(JSON.stringify({ authorize: token }));
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle authorize response
          if (data.msg_type === 'authorize') {
            if (data.error) {
              clearTimeout(timer);
              console.error('[DerivClient] Auth failed:', data.error);
              reject(new Error(`[${data.error.code || 'Auth'}] ${data.error.message || 'Authorization failed'}`));
              return;
            }
            clearTimeout(timer);
            this.authorized = true;

            const a = data.authorize;
            const accountList: AccountInfo[] = (a.account_list || []).map((acc: any) => ({
              loginid: acc.loginid,
              isVirtual: !!acc.is_virtual,
              currency: acc.currency || 'USD',
              balance: acc.balance ? parseFloat(acc.balance) : undefined,
            }));

            this.authResult = {
              loginid: a.loginid,
              fullname: a.fullname || '',
              balance: parseFloat(a.balance) || 0,
              currency: a.currency || 'USD',
              isVirtual: !!a.is_virtual,
              scopes: a.scopes || [],
              accountList,
            };

            console.log('[DerivClient] Auth OK:', a.loginid, 'virtual:', a.is_virtual, 'balance:', a.balance);

            // Now subscribe to ticks for any already-registered symbols
            for (const symbol of this.tickHandlers.keys()) {
              this.ws!.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
            }

            // Subscribe to balance
            this.ws!.send(JSON.stringify({ balance: 1, subscribe: 1 }));

            resolve(this.authResult);
            return;
          }

          // Handle pending request responses (proposal, buy, etc.)
          if (data.req_id && this.pendingRequests.has(data.req_id)) {
            const pending = this.pendingRequests.get(data.req_id)!;
            clearTimeout(pending.timer);
            this.pendingRequests.delete(data.req_id);
            if (data.error) {
              pending.reject(new Error(data.error.message || 'API error'));
            } else {
              pending.resolve(data);
            }
            return;
          }

          // Handle tick data
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

          // Handle balance updates
          if (data.msg_type === 'balance' && data.balance) {
            const bal = parseFloat(data.balance.balance) || 0;
            if (this.authResult) {
              this.authResult.balance = bal;
            }
            this.balanceHandlers.forEach(h => h({ balance: bal, loginid: data.balance.loginid }));
          }

        } catch (e) {
          console.error('[DerivClient] Message parse error', e);
        }
      };

      this.ws.onclose = (e) => {
        clearTimeout(timer);
        console.log('[DerivClient] WS closed: code=', e.code);
        const wasAuthorized = this.authorized;
        this.authorized = false;

        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(new Error('WebSocket closed'));
          this.pendingRequests.delete(id);
        }

        // If we never authorized, reject the connect promise
        if (!wasAuthorized) {
          reject(new Error(`WebSocket closed (code ${e.code}) before authorization`));
        }

        // Auto-reconnect if we were authorized
        if (wasAuthorized && !this.destroyed) {
          this.wsReconnectTimer = setTimeout(() => {
            console.log('[DerivClient] Auto-reconnecting...');
            this.connect(this.token).catch(err => {
              console.error('[DerivClient] Reconnect failed:', err.message);
            });
          }, 3000);
        }

        if (wasAuthorized || this.destroyed) {
          this.closeHandlers.forEach(h => h());
        }
      };

      this.ws.onerror = () => {
        // onclose will follow — don't reject here
        console.error('[DerivClient] WebSocket error');
      };
    });
  }

  // --- Tick Subscriptions ---

  onTick(symbol: string, handler: (tick: TickData) => void): () => void {
    if (!this.tickHandlers.has(symbol)) {
      this.tickHandlers.set(symbol, []);
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.authorized) {
        this.ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
      }
    }
    const handlers = this.tickHandlers.get(symbol)!;
    handlers.push(handler);
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
      if (handlers.length === 0) this.tickHandlers.delete(symbol);
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

  // --- Trading via WebSocket ---

  private sendWSRequest(msg: Record<string, unknown>, timeoutMs = 15000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      if (!this.authorized) {
        reject(new Error('WebSocket not authorized'));
        return;
      }

      const reqId = this.reqIdCounter++;
      const payload = { ...msg, req_id: reqId };

      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error('Request timed out'));
      }, timeoutMs);

      this.pendingRequests.set(reqId, { resolve, reject, timer });
      this.ws.send(JSON.stringify(payload));
    });
  }

  async getProposal(params: {
    contractType: string;
    symbol: string;
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

    const data = await this.sendWSRequest(payload, 5000);

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
    const data = await this.sendWSRequest({ buy: proposalId, price: askPrice }, 10000);

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
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.authorized) {
      this.ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
    }
  }

  // --- Status ---

  get isConnected(): boolean {
    return this.authorized;
  }

  getAuthResult(): AuthResult | null {
    return this.authResult;
  }

  destroy() {
    this.destroyed = true;
    this.authorized = false;
    this.authResult = null;
    if (this.wsReconnectTimer) { clearTimeout(this.wsReconnectTimer); this.wsReconnectTimer = null; }
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Client destroyed'));
      this.pendingRequests.delete(id);
    }
    this.tickHandlers.clear();
    this.balanceHandlers = [];
    this.closeHandlers.forEach(h => h());
    this.closeHandlers = [];
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }
}

// === Multi-market client ===

export class MultiMarketClient {
  private client: DerivClient | null = null;
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
    this.client = new DerivClient(this.appId);
    this.authResult = await this.client.connect(token);
    this._onLog(`Connected: ${this.authResult.loginid} | ${this.authResult.isVirtual ? 'DEMO' : 'REAL'} | $${this.authResult.balance.toFixed(2)}`);
    return this.authResult;
  }

  async subscribeTicks(symbols: string[], onTick: (tick: TickData) => void): Promise<void> {
    if (!this.client) throw new Error('Not connected');
    for (const symbol of symbols) {
      this.client.onTick(symbol, onTick);
    }
    this._onLog(`Subscribed to ${symbols.length} markets: ${symbols.join(', ')}`);
  }

  async getProposal(params: {
    contractType: string;
    symbol: string;
    stake: number;
    barrier?: number;
  }): Promise<ProposalResult> {
    if (!this.client) throw new Error('Not connected');
    return this.client.getProposal(params);
  }

  async buyContract(proposalId: string, askPrice: number): Promise<BuyResult> {
    if (!this.client) throw new Error('Not connected');
    return this.client.buyContract(proposalId, askPrice);
  }

  onBalance(handler: (data: { balance: number; loginid: string }) => void): () => void {
    return this.client?.onBalance(handler) || (() => {});
  }

  onClose(handler: () => void): () => void {
    return this.client?.onClose(handler) || (() => {});
  }

  get isConnected(): boolean {
    return this.client?.isConnected ?? false;
  }

  getAuthResult(): AuthResult | null {
    return this.authResult;
  }

  destroy() {
    this.client?.destroy();
    this.client = null;
    this.authResult = null;
  }
}

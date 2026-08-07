'use client';

// === DerivClient v3 — REST API for auth/trading, WebSocket for ticks ===
// PAT tokens don't work with WebSocket authorize.
// Use REST API (Bearer token) for auth, proposals, buys.
// Use WebSocket (unauthenticated) for tick streaming only.

const WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';
const REST_URL = 'https://api.derivws.com';

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

// === REST API helper ===

async function restRequest(endpoint: string, token: string, appId: string, options?: RequestInit): Promise<any> {
  const url = `${REST_URL}${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  ...(appId ? { 'Deriv-App-ID': appId } : {}),
  };
  const res = await fetch(url, { ...options, headers: { ...headers, ...(options?.headers as Record<string, string>) } });
  const data = await res.json();
  if (data.error) {
    throw new Error(`[${data.error.code || 'REST'}] ${data.error.message || 'API error'}${data.error.details ? ': ' + data.error.details : ''}`);
  }
  return data;
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

  constructor(appId: string) {
    this.appId = appId;
  }

  // --- Connection & Auth via REST API ---

  async connect(token: string): Promise<AuthResult> {
    if (this.authorized && this.token === token) return this.authResult!;

    this.token = token;
    this.destroyed = false;

    // Authenticate via REST API (supports PAT tokens)
    this.authResult = await this.restAuthorize(token);
    this.authorized = true;

    // Now open WebSocket for ticks (no auth needed for ticks)
    this.openTickWebSocket();

    return this.authResult;
  }

  private async restAuthorize(token: string): Promise<AuthResult> {
    console.log('[DerivClient] Authenticating via REST API...');
    try {
      const data = await restRequest('/trading/v1/options/authorize', token, this.appId);
      const a = data.authorize;
      if (!a) throw new Error('No authorize data in response');

      const accountList: AccountInfo[] = (a.account_list || []).map((acc: any) => ({
        loginid: acc.loginid,
        isVirtual: !!acc.is_virtual,
        currency: acc.currency || 'USD',
        balance: acc.balance ? parseFloat(acc.balance) : undefined,
      }));

      console.log('[DerivClient] REST auth OK:', a.loginid, 'virtual:', a.is_virtual, 'balance:', a.balance);
      return {
        loginid: a.loginid,
        fullname: a.fullname || '',
        balance: parseFloat(a.balance) || 0,
        currency: a.currency || 'USD',
        isVirtual: !!a.is_virtual,
        scopes: a.scopes || [],
        accountList,
      };
    } catch (err) {
      console.error('[DerivClient] REST auth failed:', (err as Error).message);
      throw err;
    }
  }

  // --- Tick WebSocket (unauthenticated) ---

  private openTickWebSocket(): void {
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }

    console.log('[DerivClient] Opening tick WebSocket...');
    try {
      this.ws = new WebSocket(WS_URL);
    } catch (e) {
      console.error('[DerivClient] Cannot create tick WebSocket');
      return;
    }

    this.ws.onopen = () => {
      console.log('[DerivClient] Tick WebSocket opened');
      // Re-subscribe to all tick handlers
      for (const symbol of this.tickHandlers.keys()) {
        this.ws!.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

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
      } catch (e) {
        console.error('[DerivClient] Tick parse error', e);
      }
    };

    this.ws.onclose = () => {
      console.log('[DerivClient] Tick WS closed');
      // Auto-reconnect ticks after 3s
      if (!this.destroyed && this.authorized) {
        this.wsReconnectTimer = setTimeout(() => this.openTickWebSocket(), 3000);
      }
    };

    this.ws.onerror = () => {
      // onclose will follow
    };
  }

  // --- Tick Subscriptions ---

  onTick(symbol: string, handler: (tick: TickData) => void): () => void {
    if (!this.tickHandlers.has(symbol)) {
      this.tickHandlers.set(symbol, []);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
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

  onBalance(_handler: (data: { balance: number; loginid: string }) => void): () => void {
    // Balance updates via REST polling (WebSocket balance needs auth)
    // For now, return noop — balance is fetched on connect
    return () => {};
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.push(handler);
    return () => {
      const idx = this.closeHandlers.indexOf(handler);
      if (idx >= 0) this.closeHandlers.splice(idx, 1);
    };
  }

  // --- Trading via REST API ---

  async getProposal(params: {
    contractType: string;
    symbol: string;
    stake: number;
    barrier?: number;
    duration?: number;
    durationUnit?: string;
  }): Promise<ProposalResult> {
    const payload: Record<string, unknown> = {
      amount: params.stake,
      basis: 'stake',
      contract_type: params.contractType,
      symbol: params.symbol,
      duration: params.duration || 1,
      duration_unit: params.durationUnit || 't',
    };
    if (params.barrier !== undefined) {
      payload.barrier = params.barrier.toString();
    }

    const data = await restRequest('/trading/v1/options/proposal', this.token, this.appId, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

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
    const data = await restRequest('/trading/v1/options/buy', this.token, this.appId, {
      method: 'POST',
      body: JSON.stringify({ buy: proposalId, price: askPrice }),
    });

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
    // No-op: balance tracked via REST, updated on each trade result
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

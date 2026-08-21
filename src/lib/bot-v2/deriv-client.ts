'use client';

// === DerivClient v10 — OTP Auth + Server-Side Trading Proxy ===
// PAT_ tokens require OTP pre-authenticated WebSocket for DATA (ticks, balance).
// But OTP WS does NOT support trading (proposal/buy).
// Solution: Dual-socket architecture:
//   - OTP WebSocket (browser-side): ticks, balance subscriptions
//   - Server-side proxy (/api/deriv-trade): proposal, buy (PAT_ token authorized)

import type { TickData, AuthResult, AccountInfo, ProposalResult, BuyResult } from './types';

type MsgHandler = (data: any) => void;

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
  private openPromise: Promise<AuthResult> | null = null;
  private destroyed = false;
  private isOTP = false; // true = connected via OTP flow

  constructor(appId: string) {
    this.appId = appId;
  }

  // --- Connection & Auth (REST OTP Flow) ---

  connect(token: string, preferredAccountId?: string): Promise<AuthResult> {
    if (this.openPromise) return this.openPromise;
    if (this.authorized && this.token === token) return Promise.resolve(this.authResult!);

    this.token = token;
    this.destroyed = false;
    this.openPromise = this._connectViaOTP(token, preferredAccountId);
    return this.openPromise;
  }

  get connectionType(): string {
    return this.isOTP ? 'otp+proxy' : 'standard';
  }

  private async _connectViaOTP(token: string, preferredAccountId?: string): Promise<AuthResult> {
    try {
      // Step 1: Get accounts via REST (proxied through /api/deriv-auth)
      console.log('[DerivClient] Step 1: Fetching accounts via REST...');
      const accRes = await fetch('/api/deriv-auth?action=accounts', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'x-deriv-app-id': this.appId,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!accRes.ok) {
        let details = '';
        try { details = await accRes.text(); } catch {}
        throw new Error(`Accounts request failed (HTTP ${accRes.status}). ${details.slice(0, 200)}`);
      }

      const accData = await accRes.json();

      if (!accData.data || !Array.isArray(accData.data) || accData.data.length === 0) {
        throw new Error(`No accounts found. Ensure your token has Trade scope and matches your App ID.`);
      }

      const allAccounts = accData.data;
      const firstAccount = preferredAccountId
        ? allAccounts.find((a: any) => a.account_id === preferredAccountId) || allAccounts[0]
        : allAccounts.find((a: any) => a.account_type === 'demo') || allAccounts[0];

      console.log(`[DerivClient] Found ${allAccounts.length} account(s). Using: ${firstAccount.account_id} (${firstAccount.account_type})`);

      // Step 2: Get OTP WebSocket URL via REST
      console.log('[DerivClient] Step 2: Requesting OTP WebSocket URL...');
      const otpRes = await fetch('/api/deriv-auth', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'x-deriv-app-id': this.appId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accountId: firstAccount.account_id }),
        signal: AbortSignal.timeout(10000),
      });

      if (!otpRes.ok) {
        let details = '';
        try { details = await otpRes.text(); } catch {}
        throw new Error(`OTP request failed (HTTP ${otpRes.status}). ${details.slice(0, 200)}`);
      }

      const otpData = await otpRes.json();

      if (!otpData.data?.url) {
        throw new Error(`No WebSocket URL in OTP response. Check your App ID.`);
      }

      const wsUrl: string = otpData.data.url;
      console.log('[DerivClient] Step 3: Connecting WebSocket via OTP (data-only)...');

      // Build AuthResult from REST data
      const authResult: AuthResult = {
        loginid: firstAccount.account_id,
        fullname: '',
        balance: parseFloat(firstAccount.balance) || 0,
        currency: firstAccount.currency || 'USD',
        isVirtual: firstAccount.account_type === 'demo',
        scopes: [],
        accountList: allAccounts.map((a: any) => ({
          loginid: a.account_id,
          isVirtual: a.account_type === 'demo',
          currency: a.currency || 'USD',
          balance: a.balance ? parseFloat(a.balance) : undefined,
        })),
      };

      // Step 3: Connect WebSocket to OTP URL (DATA ONLY — ticks, balance)
      await this._connectWS(wsUrl, authResult);

      // Step 4: Warm-up test — verify server proxy can make proposals
      this.isOTP = true;
      console.log('[DerivClient] Step 4: Testing server-side trading proxy...');
      try {
        const testResult = await this._serverProxyProposal({
          contractType: 'DIGITUNDER',
          symbol: '1HZ100V',
          stake: 0.40,
          barrier: 7,
          duration: 1,
          durationUnit: 't',
        });
        console.log(`[DerivClient] Server proxy trading WORKS! Test payout=$${testResult.payout.toFixed(2)}`);
        // Forget the test proposal
        this._serverProxyForget();
      } catch (err) {
        console.warn('[DerivClient] Server proxy warm-up failed (non-fatal):', (err as Error).message);
      }

      return authResult;
    } catch (err) {
      this.openPromise = null;
      throw err;
    }
  }

  private _connectWS(url: string, authResult: AuthResult): Promise<void> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(new Error('Cannot create WebSocket'));
        return;
      }
      this.ws = ws;

      const timer = setTimeout(() => {
        this.openPromise = null;
        reject(new Error('WebSocket connection timeout (15s)'));
      }, 15000);

      ws.onopen = () => {
        clearTimeout(timer);
        this.authorized = true;
        this.authResult = authResult;
        console.log('[DerivClient] WS connected (OTP pre-authenticated):', authResult.loginid, '$' + authResult.balance.toFixed(2));

        // Subscribe to balance for real-time updates
        try {
          ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        } catch {}

        resolve();
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
        clearTimeout(timer);
        const wasAuthed = this.authorized;
        this.authorized = false;
        this.authResult = null;
        this.openPromise = null;
        this.ws = null;
        this.rejectAllPending('WebSocket closed');
        if (!wasAuthed) {
          reject(new Error(`WebSocket closed (code ${event.code}). Check your App ID and token.`));
        } else {
          this.closeHandlers.forEach(h => h());
        }
      };

      ws.onerror = () => {
        // onclose will follow with details
      };
    });
  }

  private handleMessage(data: any) {
    // Pending request response (only for non-trading WS calls)
    if (data.req_id !== undefined && this.pending.has(data.req_id)) {
      const p = this.pending.get(data.req_id)!;
      this.pending.delete(data.req_id);
      clearTimeout(p.timer);
      if (data.error) {
        console.error('[DerivClient] API ERROR:', JSON.stringify(data.error));
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
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  // --- Tick Subscriptions (via OTP WebSocket — data channel) ---

  onTick(symbol: string, handler: (tick: TickData) => void): () => void {
    if (!this.tickHandlers.has(symbol)) {
      this.tickHandlers.set(symbol, []);
    }
    const handlers = this.tickHandlers.get(symbol)!;
    handlers.push(handler);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    }
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
      if (handlers.length === 0) {
        this.tickHandlers.delete(symbol);
      }
    };
  }

  resubscribeTicks(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const symbol of this.tickHandlers.keys()) {
      this.ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    }
    if (this.tickHandlers.size > 0) {
      console.log(`[DerivClient] Re-subscribed to ${this.tickHandlers.size} tick streams`);
    }
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

  // === Trading — Routed through server-side proxy for OTP connections ===

  async getProposal(params: {
    contractType: string;
    symbol: string;
    stake: number;
    barrier?: number;
    duration?: number;
    durationUnit?: string;
  }): Promise<ProposalResult> {
    if (this.isOTP) {
      return this._serverProxyProposal(params);
    }
    // Fallback: direct WS (for non-OTP tokens)
    return this._wsProposal(params);
  }

  async buyContract(proposalId: string, askPrice: number): Promise<BuyResult> {
    if (this.isOTP) {
      return this._serverProxyBuy(proposalId, askPrice);
    }
    // Fallback: direct WS (for non-OTP tokens)
    return this._wsBuy(proposalId, askPrice);
  }

  // --- Server-Side Proxy Trading (for PAT_ / OTP connections) ---

  private async _serverProxyProposal(params: {
    contractType: string;
    symbol: string;
    stake: number;
    barrier?: number;
    duration?: number;
    durationUnit?: string;
  }): Promise<ProposalResult> {
    const body: Record<string, unknown> = {
      action: 'proposal',
      token: this.token,
      appId: this.appId,
      contractType: params.contractType,
      symbol: params.symbol,
      stake: params.stake,
    };
    if (params.barrier !== undefined) body.barrier = params.barrier;
    if (params.duration !== undefined) body.duration = params.duration;
    if (params.durationUnit) body.durationUnit = params.durationUnit;

    console.log('[DerivClient] PROXY proposal:', params.contractType, params.symbol, 'barrier=' + params.barrier, '$' + params.stake);

    const res = await fetch('/api/deriv-trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();
    if (data.error) {
      throw new Error(data.error.message || data.error || 'Proxy proposal failed');
    }
    if (!data.proposal) {
      throw new Error(data.error?.message || 'No proposal in proxy response');
    }

    console.log('[DerivClient] PROXY proposal OK: ask=$' + parseFloat(data.proposal.ask_price).toFixed(2) + ' payout=$' + parseFloat(data.proposal.payout).toFixed(2));
    return {
      id: data.proposal.id,
      askPrice: parseFloat(data.proposal.ask_price) || 0,
      payout: parseFloat(data.proposal.payout) || 0,
    };
  }

  private async _serverProxyBuy(proposalId: string, askPrice: number): Promise<BuyResult> {
    const body = {
      action: 'buy',
      token: this.token,
      appId: this.appId,
      proposalId,
      askPrice,
    };

    console.log('[DerivClient] PROXY buy:', proposalId.slice(0, 16));

    const res = await fetch('/api/deriv-trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json();
    if (data.error) {
      throw new Error(data.error.message || data.error || 'Proxy buy failed');
    }
    if (!data.buy) {
      throw new Error(data.error?.message || 'No buy in proxy response');
    }

    const buyPrice = parseFloat(data.buy.buy_price) || 0;
    const payout = parseFloat(data.buy.payout) || 0;
    const balanceAfter = parseFloat(data.buy.balance_after) || 0;
    const profit = payout - buyPrice;

    console.log('[DerivClient] PROXY buy OK: contract=' + (data.buy.contract_id || '?') + ' profit=$' + profit.toFixed(2));
    return {
      contractId: data.buy.contract_id?.toString() || '',
      buyPrice,
      payout,
      profit,
      balanceAfter,
    };
  }

  private async _serverProxyForget(): Promise<void> {
    try {
      await fetch('/api/deriv-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'forget', token: this.token, appId: this.appId }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {}
  }

  // --- Direct WS Trading (fallback for non-OTP tokens) ---

  private async _wsProposal(params: {
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
      underlying: params.symbol,
      duration: params.duration || 1,
      duration_unit: params.durationUnit || 't',
      currency: 'USD',
    };
    if (params.barrier !== undefined) {
      payload.barrier = params.barrier.toString();
    }

    console.log('[DerivClient] WS proposal:', JSON.stringify(payload));
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

  private async _wsBuy(proposalId: string, askPrice: number): Promise<BuyResult> {
    this.ensureConnected();
    const data = await this.sendRequest({ buy: proposalId, price: askPrice }, 15000);
    if (!data.buy) {
      throw new Error(data.error?.message || 'Buy failed');
    }
    const buyPrice = parseFloat(data.buy.buy_price) || 0;
    const payout = parseFloat(data.buy.payout) || 0;
    const balanceAfter = parseFloat(data.buy.balance_after) || 0;
    const profit = payout - buyPrice;
    return {
      contractId: data.buy.contract_id?.toString() || '',
      buyPrice,
      payout,
      profit,
      balanceAfter,
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
        console.error(`[DerivClient] TIMEOUT req_id=${reqId} after ${timeoutMs}ms`);
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
    // Disconnect server proxy
    if (this.token && this.appId) {
      this._serverProxyForget();
      try {
        fetch('/api/deriv-trade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'disconnect', token: this.token, appId: this.appId }),
        }).catch(() => {});
      } catch {}
    }
  }
}

// === Multi-market client ===

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

  async connect(token: string, accountId?: string): Promise<AuthResult> {
    this.token = token;
    const primary = this.getOrCreateClient('primary');
    this.authResult = await primary.connect(token, accountId);
    this._onLog(`Connected: ${this.authResult.loginid} | ${this.authResult.isVirtual ? 'DEMO' : 'REAL'} | $${this.authResult.balance.toFixed(2)} | ${primary.connectionType}`);
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
    const primary = this.clients.get('primary');
    if (!primary) throw new Error('Primary client not initialized');
    for (const symbol of symbols) {
      primary.onTick(symbol, onTick);
    }
    this._onLog(`Subscribed to ${symbols.length} markets: ${symbols.join(', ')}`);
  }

  async getProposal(params: {
    contractType: string;
    symbol: string;
    stake: number;
    barrier?: number;
    duration?: number;
    durationUnit?: string;
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

  resubscribeTicks(): void {
    const primary = this.clients.get('primary');
    if (primary) primary.resubscribeTicks();
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

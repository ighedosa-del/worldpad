'use client';

// === DerivClient v12 — Single-handler, robust trading ===
// v12: Fixed duplicate handler bug. Single message handler.
//     Proper forget_all after proposals. Enhanced logging.
//     Direct WS auth (primary) + OTP proxy (fallback).

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
  private useProxy = false;
  private _authResolve: ((v: AuthResult) => void) | null = null;
  private _authReject: ((e: Error) => void) | null = null;
  private _authTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(appId: string) {
    this.appId = appId;
  }

  get connectionType(): string {
    return this.useProxy ? 'direct-ws+proxy' : 'direct-ws';
  }

  // --- Connection & Auth ---

  connect(token: string, preferredAccountId?: string): Promise<AuthResult> {
    if (this.openPromise) return this.openPromise;
    if (this.authorized && this.token === token) return Promise.resolve(this.authResult!);

    this.token = token;
    this.destroyed = false;
    this.openPromise = this._connect(token, preferredAccountId);
    return this.openPromise;
  }

  private async _connect(token: string, preferredAccountId?: string): Promise<AuthResult> {
    // Strategy 1: Direct WS auth (works for most tokens including PAT_)
    console.log('[DerivClient] Strategy 1: Direct WebSocket authorization...');
    try {
      const result = await this._connectDirectWS(token);
      console.log('[DerivClient] Direct WS auth SUCCESS — single socket for everything');
      this.useProxy = false;
      return result;
    } catch (err) {
      console.warn('[DerivClient] Direct WS auth failed:', (err as Error).message);
      console.log('[DerivClient] Falling back to Strategy 2: OTP + server proxy...');
    }

    // Strategy 2: OTP flow for data + server proxy for trading
    try {
      const result = await this._connectViaOTP(token, preferredAccountId);
      this.useProxy = true;
      return result;
    } catch (err) {
      this.openPromise = null;
      throw err;
    }
  }

  // === Strategy 1: Direct WebSocket Auth ===
  // v12 FIX: Single message handler instead of duplicate onmessage + addEventListener

  private _connectDirectWS(token: string): Promise<AuthResult> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${this.appId}`);
      } catch (e) {
        reject(new Error('Cannot create WebSocket'));
        return;
      }
      this.ws = ws;

      this._authResolve = resolve;
      this._authReject = reject;
      this._authTimer = setTimeout(() => {
        this._authResolve = null;
        this._authReject = null;
        ws.close();
        reject(new Error('Direct WS auth timeout (10s)'));
      }, 10000);

      ws.onopen = () => {
        console.log('[DerivClient] WS open, sending { authorize }...');
        ws.send(JSON.stringify({ authorize: token }));
      };

      // v12: SINGLE message handler — no more duplicate processing
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleMessage(data);
        } catch (e) {
          console.error('[DerivClient] Parse error', e);
        }
      };

      ws.onclose = (event) => {
        console.log(`[DerivClient] WS closed code=${event.code} reason=${event.reason}`);
        clearTimeout(this._authTimer!);
        const wasAuthed = this.authorized;
        this.authorized = false;
        this.authResult = null;
        this.openPromise = null;
        this.ws = null;
        this._authResolve = null;
        this._authReject = null;
        this.rejectAllPending('WebSocket closed');
        if (!wasAuthed) {
          reject(new Error(`WebSocket closed (code ${event.code})`));
        } else {
          this.closeHandlers.forEach(h => h());
        }
      };

      ws.onerror = (err) => {
        console.error('[DerivClient] WS error:', err);
      };
    });
  }

  // === Strategy 2: OTP Flow (fallback) ===

  private async _connectViaOTP(token: string, preferredAccountId?: string): Promise<AuthResult> {
    console.log('[DerivClient] OTP Step 1: Fetching accounts...');
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
      throw new Error('No accounts found. Ensure token has Trade scope.');
    }

    const allAccounts = accData.data;
    const firstAccount = preferredAccountId
      ? allAccounts.find((a: any) => a.account_id === preferredAccountId) || allAccounts[0]
      : allAccounts.find((a: any) => a.account_type === 'demo') || allAccounts[0];

    console.log(`[DerivClient] Found ${allAccounts.length} account(s). Using: ${firstAccount.account_id}`);

    console.log('[DerivClient] OTP Step 2: Getting OTP WebSocket URL...');
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
      throw new Error('No WebSocket URL in OTP response.');
    }

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

    console.log('[DerivClient] OTP Step 3: Connecting OTP WS (data only)...');
    await this._connectOTPWS(otpData.data.url, authResult);

    this.useProxy = true;
    console.log('[DerivClient] OTP Step 4: Testing server proxy...');
    try {
      const testResult = await this._serverProxyProposal({
        contractType: 'DIGITUNDER', symbol: '1HZ100V',
        stake: 0.40, barrier: 7, duration: 1, durationUnit: 't',
      });
      console.log(`[DerivClient] Server proxy WORKS! Test payout=$${testResult.payout.toFixed(2)}`);
      this._serverProxyForget();
    } catch (err) {
      console.warn('[DerivClient] Server proxy warm-up failed (non-fatal):', (err as Error).message);
    }

    return authResult;
  }

  private _connectOTPWS(url: string, authResult: AuthResult): Promise<void> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch (e) { reject(new Error('Cannot create WebSocket')); return; }
      this.ws = ws;

      const timer = setTimeout(() => {
        this.openPromise = null;
        reject(new Error('OTP WS timeout (15s)'));
      }, 15000);

      ws.onopen = () => {
        clearTimeout(timer);
        this.authorized = true;
        this.authResult = authResult;
        console.log('[DerivClient] OTP WS connected:', authResult.loginid);
        try { ws.send(JSON.stringify({ balance: 1, subscribe: 1 })); } catch {}
        resolve();
      };

      ws.onmessage = (event) => {
        try { this._handleMessage(JSON.parse(event.data)); } catch (e) { console.error('[DerivClient] Parse error', e); }
      };

      ws.onclose = (event) => {
        clearTimeout(timer);
        const wasAuthed = this.authorized;
        this.authorized = false;
        this.authResult = null;
        this.openPromise = null;
        this.ws = null;
        this.rejectAllPending('WebSocket closed');
        if (!wasAuthed) reject(new Error(`OTP WS closed (code ${event.code})`));
        else this.closeHandlers.forEach(h => h());
      };

      ws.onerror = () => {};
    });
  }

  // === Message Handling ===
  // v12: Auth response handled here too — single entry point

  private _handleMessage(data: any) {
    // 1. Handle authorize response
    if (data.msg_type === 'authorize' && this._authResolve) {
      clearTimeout(this._authTimer!);
      const resolveAuth = this._authResolve;
      const rejectAuth = this._authReject;
      this._authResolve = null;
      this._authReject = null;

      if (data.error) {
        console.error('[DerivClient] Auth FAILED:', data.error.message, 'code:', data.error.code);
        rejectAuth?.(new Error(`Auth failed: ${data.error.message} (code: ${data.error.code})`));
        return;
      }

      const auth = data.authorize;
      const result: AuthResult = {
        loginid: auth.loginid,
        fullname: auth.fullname || '',
        balance: parseFloat(auth.balance) || 0,
        currency: auth.currency || 'USD',
        isVirtual: auth.is_virtual,
        scopes: auth.scopes || [],
        accountList: auth.account_list?.map((a: any) => ({
          loginid: a.loginid,
          isVirtual: a.is_virtual,
          currency: a.currency || 'USD',
          balance: a.balance ? parseFloat(a.balance) : undefined,
        })) || [],
      };

      this.authorized = true;
      this.authResult = result;
      console.log(`[DerivClient] Auth OK: ${result.loginid} $${result.balance.toFixed(2)} ${result.isVirtual ? 'DEMO' : 'REAL'} scopes=[${result.scopes.join(',')}]`);

      // Subscribe to balance updates
      try { this.ws?.send(JSON.stringify({ balance: 1, subscribe: 1 })); } catch {}

      resolveAuth?.(result);
      return;
    }

    // 2. Handle pending request responses (proposal, buy, etc.)
    if (data.req_id !== undefined && this.pending.has(data.req_id)) {
      const p = this.pending.get(data.req_id)!;
      this.pending.delete(data.req_id);
      clearTimeout(p.timer);
      if (data.error) {
        console.error('[DerivClient] API ERROR req_id=' + data.req_id + ':', JSON.stringify(data.error));
        p.reject(new Error(data.error.message || 'API error'));
      } else {
        console.log(`[DerivClient] API OK req_id=${data.req_id} msg_type=${data.msg_type}`);
        p.resolve(data);
      }
      return;
    }

    // 3. Handle tick streams
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
      return;
    }

    // 4. Handle balance updates
    if (data.msg_type === 'balance' && data.balance) {
      const bal = parseFloat(data.balance.balance);
      if (this.authResult) this.authResult.balance = bal;
      this.balanceHandlers.forEach(h => h({ balance: bal, loginid: data.balance.loginid }));
      return;
    }
  }

  private rejectAllPending(reason: string) {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error(reason)); }
    this.pending.clear();
  }

  // === Tick Subscriptions ===

  onTick(symbol: string, handler: (tick: TickData) => void): () => void {
    if (!this.tickHandlers.has(symbol)) this.tickHandlers.set(symbol, []);
    const handlers = this.tickHandlers.get(symbol)!;
    handlers.push(handler);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    }
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
      if (handlers.length === 0) this.tickHandlers.delete(symbol);
    };
  }

  resubscribeTicks(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    for (const symbol of this.tickHandlers.keys()) {
      this.ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    }
  }

  onBalance(handler: (data: { balance: number; loginid: string }) => void): () => void {
    this.balanceHandlers.push(handler);
    return () => { const i = this.balanceHandlers.indexOf(handler); if (i >= 0) this.balanceHandlers.splice(i, 1); };
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.push(handler);
    return () => { const i = this.closeHandlers.indexOf(handler); if (i >= 0) this.closeHandlers.splice(i, 1); };
  }

  // === Trading ===

  async getProposal(params: {
    contractType: string; symbol: string; stake: number;
    barrier?: number; duration?: number; durationUnit?: string;
  }): Promise<ProposalResult> {
    if (this.useProxy) return this._serverProxyProposal(params);
    return this._wsProposal(params);
  }

  async buyContract(proposalId: string, askPrice: number): Promise<BuyResult> {
    if (this.useProxy) return this._serverProxyBuy(proposalId, askPrice);
    return this._wsBuy(proposalId, askPrice);
  }

  // v12: Forget all open proposals to prevent stream buildup
  async forgetAllProposals(): Promise<void> {
    if (this.useProxy) {
      await this._serverProxyForget();
    } else if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ forget_all: 'proposals' }));
        console.log('[DerivClient] Sent forget_all proposals');
      } catch (e) {
        console.warn('[DerivClient] forget_all failed:', (e as Error).message);
      }
    }
  }

  // --- Direct WS Trading ---

  private async _wsProposal(params: {
    contractType: string; symbol: string; stake: number;
    barrier?: number; duration?: number; durationUnit?: string;
  }): Promise<ProposalResult> {
    this.ensureConnected();
    const payload: Record<string, unknown> = {
      proposal: 1, amount: params.stake, basis: 'stake',
      contract_type: params.contractType, symbol: params.symbol,
      duration: params.duration || 1, duration_unit: params.durationUnit || 't',
      currency: 'USD',
    };
    if (params.barrier !== undefined) payload.barrier = params.barrier.toString();

    console.log(`[DerivClient] WS proposal: ${params.contractType} ${params.symbol} barrier=${params.barrier ?? '-'} $${params.stake} dur=${params.duration}${params.durationUnit}`);
    const data = await this._sendRequest(payload, 8000);
    if (!data.proposal) throw new Error(data.error?.message || 'No proposal in response');
    const askPrice = parseFloat(data.proposal.ask_price) || 0;
    const payout = parseFloat(data.proposal.payout) || 0;
    console.log(`[DerivClient] WS proposal OK: id=${data.proposal.id} ask=$${askPrice.toFixed(2)} payout=$${payout.toFixed(2)}`);
    return { id: data.proposal.id, askPrice, payout };
  }

  private async _wsBuy(proposalId: string, askPrice: number): Promise<BuyResult> {
    this.ensureConnected();
    console.log(`[DerivClient] WS buy: proposal=${proposalId.slice(0, 20)}... price=$${askPrice.toFixed(2)}`);
    const data = await this._sendRequest({ buy: proposalId, price: askPrice }, 15000);
    if (!data.buy) throw new Error(data.error?.message || 'Buy failed');
    const buyPrice = parseFloat(data.buy.buy_price) || 0;
    const payout = parseFloat(data.buy.payout) || 0;
    const profit = parseFloat(data.buy.profit) || (payout - buyPrice);
    console.log(`[DerivClient] WS buy OK: contract=${data.buy.contract_id} buyPrice=$${buyPrice.toFixed(2)} payout=$${payout.toFixed(2)} profit=$${profit.toFixed(2)}`);
    return { contractId: data.buy.contract_id?.toString() || '', buyPrice, payout, profit, balanceAfter: parseFloat(data.buy.balance_after) || 0 };
  }

  // --- Server Proxy Trading (fallback) ---

  private async _serverProxyProposal(params: {
    contractType: string; symbol: string; stake: number;
    barrier?: number; duration?: number; durationUnit?: string;
  }): Promise<ProposalResult> {
    const body: Record<string, unknown> = {
      action: 'proposal', token: this.token, appId: this.appId,
      contractType: params.contractType, symbol: params.symbol, stake: params.stake,
    };
    if (params.barrier !== undefined) body.barrier = params.barrier;
    if (params.duration !== undefined) body.duration = params.duration;
    if (params.durationUnit) body.durationUnit = params.durationUnit;

    console.log(`[DerivClient] PROXY proposal: ${params.contractType} ${params.symbol} barrier=${params.barrier ?? '-'} $${params.stake}`);
    const res = await fetch('/api/deriv-trade', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (data.error) throw new Error(typeof data.error === 'string' ? data.error : data.error.message || 'Proxy proposal failed');
    if (!data.proposal) throw new Error('No proposal in proxy response');
    const askPrice = parseFloat(data.proposal.ask_price) || 0;
    const payout = parseFloat(data.proposal.payout) || 0;
    console.log(`[DerivClient] PROXY proposal OK: id=${data.proposal.id} ask=$${askPrice.toFixed(2)} payout=$${payout.toFixed(2)}`);
    return { id: data.proposal.id, askPrice, payout };
  }

  private async _serverProxyBuy(proposalId: string, askPrice: number): Promise<BuyResult> {
    const body = { action: 'buy', token: this.token, appId: this.appId, proposalId, askPrice };
    console.log(`[DerivClient] PROXY buy: ${proposalId.slice(0, 20)}...`);
    const res = await fetch('/api/deriv-trade', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (data.error) throw new Error(typeof data.error === 'string' ? data.error : data.error.message || 'Proxy buy failed');
    if (!data.buy) throw new Error('No buy in proxy response');
    const buyPrice = parseFloat(data.buy.buy_price) || 0;
    const payout = parseFloat(data.buy.payout) || 0;
    const profit = parseFloat(data.buy.profit) || (payout - buyPrice);
    console.log(`[DerivClient] PROXY buy OK: contract=${data.buy.contract_id} profit=$${profit.toFixed(2)}`);
    return { contractId: data.buy.contract_id?.toString() || '', buyPrice, payout, profit, balanceAfter: parseFloat(data.buy.balance_after) || 0 };
  }

  private async _serverProxyForget(): Promise<void> {
    try {
      await fetch('/api/deriv-trade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'forget', token: this.token, appId: this.appId }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {}
  }

  subscribeBalance(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
    }
  }

  // --- Internal ---

  private ensureConnected() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket not connected');
    if (!this.authorized) throw new Error('WebSocket not authorized');
  }

  private _sendRequest(msg: Record<string, unknown>, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { reject(new Error('WebSocket not connected')); return; }
      const reqId = ++this.reqId;
      const timer = setTimeout(() => { this.pending.delete(reqId); reject(new Error('Request timed out (' + timeoutMs + 'ms)')); }, timeoutMs);
      this.pending.set(reqId, { resolve, reject, timer });
      const payload = { ...msg, req_id: reqId };
      console.log(`[DerivClient] >> Sending req_id=${reqId} msg_type=${(msg as any).proposal !== undefined ? 'proposal' : (msg as any).buy !== undefined ? 'buy' : 'other'}`);
      this.ws.send(JSON.stringify(payload));
    });
  }

  get isConnected(): boolean { return this.ws?.readyState === WebSocket.OPEN && this.authorized; }
  getAuthResult(): AuthResult | null { return this.authResult; }

  destroy() {
    this.destroyed = true;
    this.authorized = false;
    this.authResult = null;
    this.openPromise = null;
    this._authResolve = null;
    this._authReject = null;
    clearTimeout(this._authTimer!);
    this.rejectAllPending('Client destroyed');
    this.tickHandlers.clear();
    this.balanceHandlers = [];
    this.closeHandlers = [];
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    if (this.useProxy && this.token && this.appId) {
      try {
        fetch('/api/deriv-trade', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    this._onLog(`Connected: ${this.authResult.loginid} | ${this.authResult.isVirtual ? 'DEMO' : 'REAL'} | $${this.authResult.balance.toFixed(2)} | ${primary.connectionType} | scopes=[${this.authResult.scopes.join(',')}]`);
    return this.authResult;
  }

  private getOrCreateClient(symbol: string): DerivClient {
    let client = this.clients.get(symbol);
    if (!client) { client = new DerivClient(this.appId); this.clients.set(symbol, client); }
    return client;
  }

  async subscribeTicks(symbols: string[], onTick: (tick: TickData) => void): Promise<void> {
    if (!this.token) throw new Error('Not connected');
    const primary = this.clients.get('primary');
    if (!primary) throw new Error('Primary client not initialized');
    for (const symbol of symbols) primary.onTick(symbol, onTick);
    this._onLog(`Subscribed to ${symbols.length} markets: ${symbols.join(', ')}`);
  }

  async getProposal(params: { contractType: string; symbol: string; stake: number; barrier?: number; duration?: number; durationUnit?: string; }): Promise<ProposalResult> {
    const primary = this.clients.get('primary');
    if (!primary) throw new Error('Not connected');
    return primary.getProposal(params);
  }

  async buyContract(proposalId: string, askPrice: number): Promise<BuyResult> {
    const primary = this.clients.get('primary');
    if (!primary) throw new Error('Not connected');
    return primary.buyContract(proposalId, askPrice);
  }

  async forgetAllProposals(): Promise<void> {
    const primary = this.clients.get('primary');
    if (!primary) return;
    return primary.forgetAllProposals();
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

  get isConnected(): boolean { return this.clients.get('primary')?.isConnected ?? false; }
  getAuthResult(): AuthResult | null { return this.authResult; }

  destroy() {
    for (const [, client] of this.clients) client.destroy();
    this.clients.clear();
    this.authResult = null;
  }
}

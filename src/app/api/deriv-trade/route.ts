// === Server-side Deriv Trading Proxy ===
// PAT_ tokens authorize fine on browser WS, but the OTP WS URL
// from Deriv's trading API doesn't support proposal/buy trading calls.
// This route opens a server-side WS, authorizes with the PAT_ token,
// and proxies proposal/buy requests from the client.

import { NextRequest, NextResponse } from 'next/server';

const WS_BASE = 'wss://ws.derivws.com/websockets/v3';

interface ServerConn {
  ws: any;
  appId: string;
  token: string;
  authorized: boolean;
  loginid: string;
  pending: Map<string, {
    resolve: (data: any) => void;
    reject: (data: any) => void;
    timer: ReturnType<typeof setTimeout>;
  }>;
  lastUsed: number;
}

const connections = new Map<string, ServerConn>();

function getKey(token: string, appId: string) { return `${token.slice(0, 12)}_${appId}`; }

let cleanupTimer: ReturnType<typeof setInterval> | null = null;
function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, conn] of connections) {
      if (now - conn.lastUsed > 5 * 60 * 1000) {
        console.log('[deriv-trade] Cleanup idle:', key);
        try { conn.ws?.close(); } catch {}
        connections.delete(key);
      }
    }
  }, 60000);
}

async function getOrCreateConnection(token: string, appId: string): Promise<{ ws: any; loginid: string }> {
  ensureCleanup();
  const key = getKey(token, appId);
  let conn = connections.get(key);

  if (conn && conn.ws && conn.authorized && conn.ws.readyState === 1) {
    conn.lastUsed = Date.now();
    return { ws: conn.ws, loginid: conn.loginid };
  }

  if (conn) {
    try { conn.ws?.close(); } catch {}
    connections.delete(key);
  }

  console.log('[deriv-trade] Creating server-side WS...');

  const wsModule = await import('ws');
  const WSServer = (wsModule as any).default || (wsModule as any).WebSocket;

  return new Promise((resolve, reject) => {
    const ws = new WSServer(`${WS_BASE}?app_id=${appId}`);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('Server WS timeout (15s)'));
    }, 15000);

    const pending = new Map<string, {
      resolve: (data: any) => void;
      reject: (data: any) => void;
      timer: ReturnType<typeof setTimeout>;
    }>();

    ws.on('open', () => {
      console.log('[deriv-trade] WS open, authorizing PAT_ token...');
      ws.send(JSON.stringify({ authorize: token }));
    });

    ws.on('message', (raw: any) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.msg_type === 'authorize') {
          if (data.error) {
            clearTimeout(timer);
            console.error('[deriv-trade] Auth FAILED:', data.error.message, 'code:', data.error.code);
            try { ws.close(); } catch {}
            reject(new Error(`Authorization failed: ${data.error.message} (code: ${data.error.code})`));
            return;
          }
          clearTimeout(timer);
          const loginid = data.authorize?.loginid || 'unknown';
          console.log('[deriv-trade] Auth OK:', loginid, '$' + (data.authorize?.balance || '?'));

          connections.set(key, { ws, appId, token, authorized: true, loginid, pending, lastUsed: Date.now() });
          resolve({ ws, loginid });
          return;
        }

        const rid = data.req_id;
        if (rid && pending.has(rid)) {
          const p = pending.get(rid)!;
          pending.delete(rid);
          clearTimeout(p.timer);
          p.resolve(data);
          return;
        }
      } catch (e) {
        console.error('[deriv-trade] Parse error:', e);
      }
    });

    ws.on('close', () => {
      clearTimeout(timer);
      for (const [rid, p] of pending) { clearTimeout(p.timer); p.reject({ error: { message: 'WS closed' } }); pending.delete(rid); }
      const c = connections.get(key);
      if (c) { c.authorized = false; }
    });

    ws.on('error', (err: Error) => {
      console.error('[deriv-trade] WS error:', err.message);
      clearTimeout(timer);
      reject(new Error(`WS connection error: ${err.message}`));
    });
  });
}

function sendAndWait(ws: any, conn: ServerConn, msg: any, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const reqId = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    msg.req_id = reqId;

    const timer = setTimeout(() => {
      conn.pending.delete(reqId);
      reject({ error: { message: `Server timeout (${timeoutMs}ms)`, code: 'TIMEOUT' } });
    }, timeoutMs);

    conn.pending.set(reqId, { resolve, reject: reject as any, timer });
    ws.send(JSON.stringify(msg));
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, token, appId, ...params } = body;

    if (!token || !appId || !action) {
      return NextResponse.json({ error: 'Missing token, appId, or action' }, { status: 400 });
    }

    const { ws, loginid } = await getOrCreateConnection(token, appId);
    const key = getKey(token, appId);
    const conn = connections.get(key);
    if (!conn) return NextResponse.json({ error: 'Connection lost' }, { status: 500 });

    if (action === 'proposal') {
      // v13: Use get_price:1 (single-shot) instead of proposal:1 (stream)
      const msg: Record<string, unknown> = {
        get_price: 1,
        amount: params.stake,
        basis: 'stake',
        contract_type: params.contractType,
        symbol: params.symbol,
        currency: 'USD',
        subscribe: 0,
      };
      if (params.duration !== undefined) msg.duration = params.duration;
      if (params.durationUnit) msg.duration_unit = params.durationUnit;
      if (params.barrier !== undefined) msg.barrier = params.barrier.toString();

      console.log('[deriv-trade] get_price:', params.contractType, params.symbol, 'barrier=' + params.barrier, '$' + params.stake);
      const result = await sendAndWait(ws, conn, msg, 10000);
      return NextResponse.json(result);
    }

    if (action === 'buy') {
      const msg = { buy: params.proposalId, price: params.askPrice };
      console.log('[deriv-trade] Buy:', params.proposalId?.slice(0, 16));
      const result = await sendAndWait(ws, conn, msg, 15000);
      return NextResponse.json(result);
    }

    if (action === 'forget') {
      ws.send(JSON.stringify({ forget_all: 'proposals' }));
      return NextResponse.json({ ok: true });
    }

    if (action === 'disconnect') {
      try { ws.close(); } catch {}
      connections.delete(key);
      return NextResponse.json({ disconnected: true });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    console.error('[deriv-trade] Error:', err?.message || err);
    const status = err?.message?.includes('Authorization failed') ? 401 : 500;
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status });
  }
}

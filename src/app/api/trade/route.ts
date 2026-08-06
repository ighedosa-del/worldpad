import { NextRequest, NextResponse } from 'next/server';

const DERIV_API = 'https://api.derivws.com/api/v2';
const APP_ID = '341aJK71v75g15Vud3q6w';

async function derivRequest(action: string, body: Record<string, unknown>, token?: string) {
  const payload = { ...body, app_id: APP_ID };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  try {
    const res = await fetch(`${DERIV_API}/${action}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    // Read as text first to avoid JSON parse errors on non-JSON responses
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { error: { message: `Invalid response from Deriv API (HTTP ${res.status}). ${text.slice(0, 200)}` } };
    }
  } catch (err) {
    const msg = (err as Error).message || '';
    // Detect network/DNS blocks common in sandboxed environments
    const isNetworkBlock = msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') ||
      msg.includes('fetch failed') || msg.includes('NetworkError') || msg.includes('abort') ||
      msg.includes('timeout') || msg.includes('Unexpected non-whitespace');
    if (isNetworkBlock) {
      return { error: { message: 'Cannot reach Deriv API — this environment may block external requests. Use simulation mode instead.', code: 'NETWORK_BLOCKED' } };
    }
    return { error: { message: `Network error: ${msg}` } };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, token, params } = body;

    if (!action) {
      return NextResponse.json({ error: 'Missing action' }, { status: 400 });
    }

    console.log(`[trade] ${action}`);

    switch (action) {
      case 'authorize': {
        if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });
        const result = await derivRequest('authorize', { authorize: token }, token);
        return NextResponse.json(result);
      }

      case 'proposal': {
        if (!token || !params) return NextResponse.json({ error: 'Missing token or params' }, { status: 400 });
        const proposalBody: Record<string, unknown> = {
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
          proposalBody.barrier = params.barrier.toString();
        }
        const result = await derivRequest('proposal', proposalBody, token);
        return NextResponse.json(result);
      }

      case 'buy': {
        if (!token || !params?.proposalId) return NextResponse.json({ error: 'Missing token or proposalId' }, { status: 400 });
        const result = await derivRequest('buy', { buy: params.proposalId, price: params.askPrice }, token);
        return NextResponse.json(result);
      }

      case 'balance': {
        if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });
        const result = await derivRequest('balance', { balance: 1, subscribe: 1 }, token);
        return NextResponse.json(result);
      }

      case 'simulate': {
        // Simulation mode: client sends trade params, server returns simulated result
        if (!params) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
        const { contractType, barrier, stake } = params;
        // Determine win probability based on contract type
        let winProb: number;
        switch (contractType) {
          case 'DIGITMATCH': winProb = 0.1; break;
          case 'DIGITDIFF': winProb = 0.9; break;
          case 'DIGITOVER':
          case 'DIGITUNDER': winProb = (barrier ?? 5) / 10; break;
          case 'DIGITEVEN':
          case 'DIGITODD': winProb = 0.5; break;
          default: winProb = 0.5;
        }
        const won = Math.random() < winProb;
        const payout = won
          ? parseFloat(stake) * (contractType === 'DIGITMATCH' ? 8.5 : 0.85)
          : 0;
        const profit = payout - parseFloat(stake);
        return NextResponse.json({
          simulated: true,
          buy: {
            contract_id: `SIM-${Date.now()}`,
            payout: payout.toFixed(2),
            profit: profit.toFixed(2),
            buy_price: stake,
            won,
          }
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[trade] Error:', (err as Error).message);
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 });
  }
}

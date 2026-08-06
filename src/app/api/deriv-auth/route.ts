import { NextRequest, NextResponse } from 'next/server';

const DERIV_REST = 'https://api.derivws.com';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  const appId = req.headers.get('x-deriv-app-id');

  if (!token || !appId) {
    return NextResponse.json({ error: 'Missing token or app ID' }, { status: 400 });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Deriv-App-ID': appId,
  };

  try {
    if (action === 'accounts') {
      const res = await fetch(`${DERIV_REST}/trading/v1/options/accounts`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  const appId = req.headers.get('x-deriv-app-id');

  if (!token || !appId) {
    return NextResponse.json({ error: 'Missing token or app ID' }, { status: 400 });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Deriv-App-ID': appId,
  };

  try {
    const body = await req.json();
    const { accountId } = body;

    if (!accountId) {
      return NextResponse.json({ error: 'Missing accountId' }, { status: 400 });
    }

    const res = await fetch(`${DERIV_REST}/trading/v1/options/accounts/${accountId}/otp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

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

      const text = await res.text();

      // If Deriv returns non-JSON (HTML error page, etc.), return useful info
      if (!res.ok) {
        return NextResponse.json({
          error: `Deriv API returned HTTP ${res.status}`,
          status: res.status,
          body: text.slice(0, 500),
        }, { status: 502 });
      }

      try {
        const data = JSON.parse(text);
        return NextResponse.json(data);
      } catch {
        return NextResponse.json({
          error: 'Deriv returned non-JSON response',
          body: text.slice(0, 500),
        }, { status: 502 });
      }
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

    const text = await res.text();

    if (!res.ok) {
      return NextResponse.json({
        error: `Deriv API returned HTTP ${res.status}`,
        status: res.status,
        body: text.slice(0, 500),
      }, { status: 502 });
    }

    try {
      const data = JSON.parse(text);
      return NextResponse.json(data);
    } catch {
      return NextResponse.json({
        error: 'Deriv returned non-JSON response',
        body: text.slice(0, 500),
      }, { status: 502 });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

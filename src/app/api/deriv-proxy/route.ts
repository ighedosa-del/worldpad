import { NextRequest, NextResponse } from 'next/server';

const DERIV_REST = 'https://api.derivws.com/trading/v1/options';
const LEGACY_APP_ID = '1089';

// Proxy Deriv REST calls to avoid CORS issues from the browser
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let { path, method = 'GET', token, appId } = body;

    if (!token || !path) {
      return NextResponse.json({ error: 'Missing token or path' }, { status: 400 });
    }

    // Use provided appId or fall back to legacy default
    const appIdToUse = appId || LEGACY_APP_ID;

    // Auto-add pat_ prefix if user copied without it
    const trimmedToken = token.trim();
    if (!trimmedToken.startsWith('pat_') && !trimmedToken.startsWith('Bearer ')) {
      token = `pat_${trimmedToken}`;
    }

    const url = `${DERIV_REST}${path}`;
    console.log(`[deriv-proxy] ${method} ${url} (appId: ${appIdToUse}, token prefix: ${token.substring(0, 7)}...)`);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Deriv-App-ID': appIdToUse,
      'Content-Type': 'application/json',
    };

    const fetchOpts: RequestInit = { method, headers };

    if (method === 'POST' && body.payload) {
      fetchOpts.body = JSON.stringify(body.payload);
    }

    let res: Response;
    try {
      res = await fetch(url, { ...fetchOpts, signal: AbortSignal.timeout(15000) });
    } catch (fetchErr) {
      console.error(`[deriv-proxy] Fetch failed:`, (fetchErr as Error).message);
      return NextResponse.json({
        status: 0,
        data: { message: `Network error reaching Deriv: ${(fetchErr as Error).message}. The REST API endpoint may be unavailable.` }
      });
    }

    let data: unknown;
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 500) };
    }

    // If we get "Invalid or expired token" AND we auto-added pat_, try without the prefix
    if (res.status === 401 && data && typeof data === 'object' &&
        'message' in data && (data as Record<string, string>).message?.includes('Invalid or expired') &&
        trimmedToken !== token) {
      console.log(`[deriv-proxy] pat_ prefix didn't work, trying original token without prefix...`);
      const retryHeaders = { ...headers, 'Authorization': `Bearer ${trimmedToken}` };
      try {
        res = await fetch(url, { method, headers: retryHeaders, body: fetchOpts.body, signal: AbortSignal.timeout(15000) });
        const retryText = await res.text();
        try { data = JSON.parse(retryText); } catch { data = { message: retryText.slice(0, 500) }; }
      } catch (retryErr) {
        // Keep original error
      }
    }

    console.log(`[deriv-proxy] Response ${res.status} from ${url}`);
    return NextResponse.json({ status: res.status, data });
  } catch (err) {
    console.error(`[deriv-proxy] Error:`, (err as Error).message);
    return NextResponse.json({ status: 0, data: { message: (err as Error).message } });
  }
}

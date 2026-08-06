  // Direct test of PAT API trade formats to find the working one
const PAT_TOKEN = 'pat_cce57738de3c9bd729406c5ed086599d7e1e35219a4fb3c4bc984dc034ddd9f2';
const APP_ID = '341aJK71v75g15Vud3q6w';
const REST_BASE = 'https://api.derivws.com/trading/v1/options';

async function restCall(path, method = 'GET', body) {
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${PAT_TOKEN}`,
      'Deriv-App-ID': APP_ID,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${REST_BASE}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  return { status: res.status, data };
}

async function wsSend(ws, msg) {
  return new Promise((resolve, reject) => {
    const id = Date.now() + Math.random();
    msg.req_id = id;
    const timer = setTimeout(() => { ws.removeEventListener('message', handler); reject(new Error('timeout')); }, 10000);
    function handler(ev) {
      const data = JSON.parse(ev.data);
      if (data.req_id === id) {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
        resolve(data);
      }
    }
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify(msg));
  });
}

async function main() {
  console.log('=== Step 1: Get accounts ===');
  const accounts = await restCall(`/accounts`);
  console.log('Accounts status:', accounts.status);
  console.log('Accounts:', JSON.stringify(accounts.data).substring(0, 500));
  
  const accountList = accounts.data?.accounts || accounts.data?.data || [];
  const account = accountList[0];
  if (!account) { console.log('No account found'); return; }
  console.log('\nUsing account:', account.account_id);
  
  console.log('\n=== Step 2: Get OTP WebSocket URL ===');
  const otp = await restCall(`/accounts/${account.account_id}/otp`, 'POST');
  console.log('OTP status:', otp.status);
  console.log('OTP data:', JSON.stringify(otp.data).substring(0, 500));
  
  const otpInner = otp.data?.data || otp.data;
  const wsUrl = otpInner?.ws_url || otpInner?.url;
  if (!wsUrl) { console.log('No WebSocket URL'); return; }
  console.log('WS URL:', wsUrl.substring(0, 100));
  
  console.log('\n=== Step 3: Connect to PAT WebSocket ===');
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
    setTimeout(() => reject(new Error('ws timeout')), 15000);
  });
  console.log('WebSocket connected!');
  
  // Test what calls are available
  console.log('\n=== Step 4: Test proposal with symbol ===');
  let result;
  try {
    result = await wsSend(ws, {
      proposal: 1,
      amount: 0.35,
      basis: 'stake',
      contract_type: 'DIGITEVEN',
      currency: 'USD',
      duration: 5,
      duration_unit: 't',
      symbol: 'R_10',
    });
    console.log('Proposal WITH symbol:', JSON.stringify(result).substring(0, 500));
  } catch (e) { console.log('Proposal error:', e.message); }
  
  console.log('\n=== Step 5: Test proposal without symbol ===');
  try {
    result = await wsSend(ws, {
      proposal: 1,
      amount: 0.35,
      basis: 'stake',
      contract_type: 'DIGITEVEN',
      currency: 'USD',
      duration: 5,
      duration_unit: 't',
    });
    console.log('Proposal WITHOUT symbol:', JSON.stringify(result).substring(0, 500));
  } catch (e) { console.log('Proposal error:', e.message); }
  
  console.log('\n=== Step 6: Test buy:1 with parameters (no symbol) ===');
  try {
    result = await wsSend(ws, {
      buy: 1,
      price: 10,
      parameters: {
        amount: 0.35,
        basis: 'stake',
        contract_type: 'DIGITEVEN',
        currency: 'USD',
        duration: 5,
        duration_unit: 't',
      },
    });
    console.log('Buy:1 without symbol:', JSON.stringify(result).substring(0, 500));
  } catch (e) { console.log('Buy error:', e.message); }
  
  console.log('\n=== Step 7: Test buy:1 with parameters + symbol ===');
  try {
    result = await wsSend(ws, {
      buy: 1,
      price: 10,
      parameters: {
        amount: 0.35,
        basis: 'stake',
        contract_type: 'DIGITEVEN',
        currency: 'USD',
        duration: 5,
        duration_unit: 't',
        symbol: 'R_10',
      },
    });
    console.log('Buy:1 WITH symbol:', JSON.stringify(result).substring(0, 500));
  } catch (e) { console.log('Buy error:', e.message); }
  
  console.log('\n=== Step 8: Test proposal with market instead of symbol ===');
  try {
    result = await wsSend(ws, {
      proposal: 1,
      amount: 0.35,
      basis: 'stake',
      contract_type: 'DIGITEVEN',
      currency: 'USD',
      duration: 5,
      duration_unit: 't',
      market: 'synthetic_index',
    });
    console.log('Proposal with market:', JSON.stringify(result).substring(0, 500));
  } catch (e) { console.log('Proposal error:', e.message); }
  
  console.log('\n=== Step 9: List available calls (active_symbols) ===');
  try {
    result = await wsSend(ws, { active_symbols: 'brief', product_type: 'basic' });
    console.log('Active symbols (first 300):', JSON.stringify(result).substring(0, 300));
  } catch (e) { console.log('Active symbols error:', e.message); }
  
  ws.close();
  console.log('\nDone!');
}

main().catch(console.error);

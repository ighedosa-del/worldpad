const PAT_TOKEN = 'pat_cce57738de3c9bd729406c5ed086599d7e1e35219a4fb3c4bc984dc034ddd9f2';
const APP_ID = '341aJK71v75g15Vud3q6w';
const REST_BASE = 'https://api.derivws.com/trading/v1/options';

async function restCall(path, method = 'GET') {
  const res = await fetch(`${REST_BASE}${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${PAT_TOKEN}`, 'Deriv-App-ID': APP_ID, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) };
  } catch { return { status: res.status, data: { raw: text.slice(0, 500) } }; }
}

let reqId = 1;
function wsSend(ws, msg) {
  return new Promise((resolve, reject) => {
    const id = ++reqId;
    msg.req_id = id;
    const timer = setTimeout(() => { ws.removeEventListener('message', handler); reject(new Error('timeout')); }, 10000);
    function handler(ev) {
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }
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
  // Get REAL account (not demo)
  const accounts = await restCall('/accounts');
  const accountList = accounts.data?.data || [];
  const account = accountList.find(a => a.account_type === 'real') || accountList[0];
  console.log('Using account:', account.account_id, 'balance:', account.balance);

  // Get OTP WebSocket URL
  const otp = await restCall(`/accounts/${account.account_id}/otp`, 'POST');
  const wsUrl = otp.data?.data?.url || otp.data?.data?.ws_url;
  console.log('WS URL:', wsUrl);

  // Connect
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; setTimeout(() => reject(new Error('ws timeout')), 15000); });
  console.log('Connected!');

  // Test 1: buy:1 with underlying_symbol
  console.log('\n=== Test 1: buy:1 with underlying_symbol ===');
  try {
    const result = await wsSend(ws, {
      buy: 1,
      price: 10,
      parameters: {
        amount: 0.35,
        basis: 'stake',
        contract_type: 'DIGITEVEN',
        currency: 'USD',
        duration: 5,
        duration_unit: 't',
        underlying_symbol: 'R_10',
      },
    });
    console.log('Result:', JSON.stringify(result).substring(0, 600));
  } catch (e) { console.log('Error:', e.message); }

  ws.close();
  console.log('\nDone!');
}

main().catch(console.error);

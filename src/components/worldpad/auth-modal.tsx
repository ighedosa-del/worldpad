'use client';

import { useState, useEffect } from 'react';
import { useWorldpadStore } from '@/lib/store';
import { authorizeViaWS, getDerivAccounts, type DerivAccount } from '@/lib/deriv-ws';
import { LogIn, X, Key, Loader2, CheckCircle2, Shield, AlertTriangle, Wallet, ChevronRight } from 'lucide-react';

type AccountMode = 'demo' | 'real';
type Step = 'credentials' | 'select-account' | 'connected';

export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    accountMode, setAccountMode, demoToken, realToken, derivAppId,
    setDemoToken, setRealToken, setDerivAppId,
    isAuthorized, authorizing, setAuthorizing,
    setAccountInfo, setBalance, setIsAuthorized,
    selectedAccountId, setSelectedAccountId,
  } = useWorldpadStore();

  const [mode, setMode] = useState<AccountMode>(accountMode);
  const [step, setStep] = useState<Step>('credentials');
  const [inputToken, setInputToken] = useState('');
  const [inputAppId, setInputAppId] = useState('');
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<DerivAccount[]>([]);

  // Sync local mode with store
  useEffect(() => { setMode(accountMode); }, [accountMode]);
  // Pre-fill with saved values
  useEffect(() => {
    setInputToken(mode === 'demo' ? demoToken : realToken);
    setInputAppId(derivAppId);
  }, [mode, demoToken, realToken, derivAppId]);

  // If authorized, show connected state
  useEffect(() => {
    if (isAuthorized && open) setStep('connected');
  }, [isAuthorized, open]);

  if (!open) return null;

  const isReal = mode === 'real';
  const modeColor = isReal ? '#ef4444' : '#00d4aa';
  const modeLabel = isReal ? 'REAL' : 'DEMO';

  const handleLogin = async () => {
    if (!inputToken.trim()) { setError('Enter your PAT token'); return; }
    if (!inputAppId.trim()) { setError('Enter your Deriv App ID'); return; }
    setError('');
    setAuthorizing(true);

    try {
      // Step 1: Fetch accounts
      const accs = await getDerivAccounts(inputToken.trim(), inputAppId.trim());
      if (!accs.length) {
        setError('No accounts found. Make sure your token has the right scopes.');
        setAuthorizing(false);
        return;
      }
      setAccounts(accs);

      // Step 2: Auto-select matching account type, or show selector
      const matching = accs.filter(a => a.account_type === mode);
      if (matching.length === 1) {
        await connectAccount(inputToken.trim(), inputAppId.trim(), matching[0].account_id);
      } else if (matching.length > 1) {
        // Show account selector
        setStep('select-account');
        setAuthorizing(false);
      } else {
        // No matching account type — show all accounts and let user pick
        setStep('select-account');
        setAuthorizing(false);
      }
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.includes('fetch') || msg.includes('Failed') || msg.includes('network') || msg.includes('Network')) {
        setError('NETWORK_BLOCKED');
      } else {
        setError(msg);
      }
    } finally {
      setAuthorizing(false);
    }
  };

  const connectAccount = async (token: string, appId: string, accountId: string) => {
    setAuthorizing(true);
    try {
      const result = await authorizeViaWS(token, appId, accountId);

      // Save credentials
      if (isReal) {
        setRealToken(token);
      } else {
        setDemoToken(token);
      }
      setDerivAppId(appId);
      setAccountMode(mode);
      setSelectedAccountId(accountId);
      setIsAuthorized(true);
      setAccountInfo({
        fullname: result.fullname,
        loginid: result.loginid,
        balance: result.balance,
        currency: result.currency,
      });
      setBalance(result.balance);
      setStep('connected');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAuthorizing(false);
    }
  };

  const handleModeSwitch = (newMode: AccountMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    setError('');
    setStep('credentials');
    const token = newMode === 'demo' ? demoToken : realToken;
    if (token) setInputToken(token);
  };

  const handleLogout = () => {
    if (isReal) setRealToken('');
    else setDemoToken('');
    setIsAuthorized(false);
    setAccountInfo(null);
    setSelectedAccountId('');
    setInputToken('');
    setStep('credentials');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-sm rounded-2xl p-6 relative" style={{
        background: '#161b22',
        border: `1px solid ${isReal ? 'rgba(239,68,68,0.15)' : 'rgba(0,212,170,0.15)'}`,
        boxShadow: `0 0 60px rgba(0,0,0,0.5), 0 0 30px ${isReal ? 'rgba(239,68,68,0.05)' : 'rgba(0,212,170,0.05)'}`,
      }}>
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{
            background: isReal
              ? 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(239,68,68,0.05))'
              : 'linear-gradient(135deg, rgba(0,212,170,0.15), rgba(224,64,251,0.15))',
            border: `1px solid ${isReal ? 'rgba(239,68,68,0.2)' : 'rgba(0,212,170,0.2)'}`,
          }}>
            <Key className="w-5 h-5" style={{ color: modeColor }} />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Connect Account</h2>
            <p className="text-[10px] text-gray-500">Deriv PAT Token + App ID</p>
          </div>
        </div>

        {/* REAL / DEMO TOGGLE */}
        <div className="flex rounded-xl overflow-hidden mb-5" style={{
          background: '#000000',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <button
            onClick={() => handleModeSwitch('demo')}
            className="flex-1 py-2.5 text-xs font-bold transition-all duration-200 flex items-center justify-center gap-1.5"
            style={!isReal ? {
              background: 'linear-gradient(135deg, #00d4aa, #00b8a9)',
              color: '#0d1117',
              boxShadow: '0 0 16px rgba(0,212,170,0.3)',
            } : { color: '#7d8590' }}
          >
            <Shield className="w-3.5 h-3.5" />
            DEMO
          </button>
          <button
            onClick={() => handleModeSwitch('real')}
            className="flex-1 py-2.5 text-xs font-bold transition-all duration-200 flex items-center justify-center gap-1.5"
            style={isReal ? {
              background: 'linear-gradient(135deg, #ef4444, #dc2626)',
              color: 'white',
              boxShadow: '0 0 16px rgba(239,68,68,0.3)',
            } : { color: '#7d8590' }}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            REAL
          </button>
        </div>

        {/* Mode warning/reassurance */}
        {isReal ? (
          <div className="rounded-lg p-2.5 mb-4 flex items-start gap-2" style={{
            background: 'rgba(239,68,68,0.06)',
            border: '1px solid rgba(239,68,68,0.15)',
          }}>
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
            <p className="text-[10px] text-red-400/80 leading-relaxed">You are connecting with <span className="font-bold text-red-400">real funds</span>. Trades will use actual money.</p>
          </div>
        ) : (
          <div className="rounded-lg p-2.5 mb-4 flex items-start gap-2" style={{
            background: 'rgba(0,212,170,0.04)',
            border: '1px solid rgba(0,212,170,0.12)',
          }}>
            <Shield className="w-3.5 h-3.5 text-[#00d4aa] mt-0.5 shrink-0" />
            <p className="text-[10px] text-[#00d4aa]/70 leading-relaxed"><span className="font-bold text-[#00d4aa]">Demo mode</span> — virtual funds, no real money at risk.</p>
          </div>
        )}

        {/* ===== CONNECTED STATE ===== */}
        {step === 'connected' && isAuthorized ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl p-4" style={{
              background: isReal ? 'rgba(239,68,68,0.04)' : 'rgba(0,212,170,0.04)',
              border: `1px solid ${isReal ? 'rgba(239,68,68,0.15)' : 'rgba(0,212,170,0.15)'}`,
            }}>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4" style={{ color: modeColor }} />
                <span className="text-xs font-bold" style={{ color: modeColor }}>{modeLabel} Account Connected</span>
              </div>
              <p className="text-xs text-gray-400">Trading is enabled ({modeLabel} funds)</p>
            </div>
            <button onClick={handleLogout} className="w-full py-2.5 rounded-xl text-xs font-bold text-white transition-all hover:brightness-110" style={{
              background: 'linear-gradient(135deg, #dc2626, #ef4444)',
              boxShadow: '0 0 12px rgba(220,38,38,0.3)',
            }}>
              Disconnect {modeLabel}
            </button>
          </div>
        ) : step === 'select-account' ? (
          /* ===== ACCOUNT SELECTOR ===== */
          <div className="flex flex-col gap-3">
            <p className="text-xs text-gray-400">Select your {modeLabel.toLowerCase()} account:</p>
            {accounts.map((acc) => (
              <button
                key={acc.account_id}
                onClick={() => connectAccount(inputToken.trim(), inputAppId.trim(), acc.account_id)}
                className="w-full flex items-center justify-between p-3 rounded-xl transition-all hover:brightness-110"
                style={{
                  background: acc.account_type === mode ? 'rgba(0,212,170,0.06)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${acc.account_type === mode ? 'rgba(0,212,170,0.2)' : 'rgba(255,255,255,0.06)'}`,
                }}
              >
                <div className="flex items-center gap-3">
                  <Wallet className="w-4 h-4" style={{ color: acc.account_type === 'demo' ? '#00d4aa' : '#ef4444' }} />
                  <div className="text-left">
                    <p className="text-xs font-bold text-white">{acc.account_id}</p>
                    <p className="text-[10px] text-gray-500">
                      {acc.account_type.toUpperCase()} · ${parseFloat(acc.balance).toLocaleString()} {acc.currency}
                    </p>
                  </div>
                </div>
                {acc.account_type === mode && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{
                    background: 'rgba(0,212,170,0.15)',
                    color: '#00d4aa',
                  }}>MATCH</span>
                )}
                <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
              </button>
            ))}
            <button onClick={() => setStep('credentials')} className="text-[10px] text-gray-500 hover:text-white transition-colors mt-1">
              ← Back to credentials
            </button>
          </div>
        ) : (
          /* ===== CREDENTIALS FORM ===== */
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">App ID</label>
              <input
                type="text"
                value={inputAppId}
                onChange={(e) => setInputAppId(e.target.value)}
                placeholder="e.g. 341aJK71v75g15Vud3q6w"
                className="w-full text-white text-xs px-4 py-3 rounded-xl outline-none transition-all"
                style={{
                  background: '#000000',
                  border: `1px solid ${error ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.1)'}`,
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">PAT Token</label>
              <input
                type="password"
                value={inputToken}
                onChange={(e) => setInputToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="pat_xxxxxxxxxxxx..."
                className="w-full text-white text-xs px-4 py-3 rounded-xl outline-none transition-all"
                style={{
                  background: '#000000',
                  border: `1px solid ${error ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.1)'}`,
                }}
              />
              {error === 'NETWORK_BLOCKED' ? (
                <div className="rounded-lg p-3 flex flex-col gap-2" style={{
                  background: 'rgba(234,179,8,0.06)',
                  border: '1px solid rgba(234,179,8,0.2)',
                }}>
                  <p className="text-[10px] text-yellow-400 font-medium">Cannot reach Deriv servers.</p>
                  <button onClick={() => { setError(''); onClose(); }} className="w-full py-2 rounded-lg text-[10px] font-bold text-yellow-400 transition-all hover:brightness-110"
                    style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)' }}>
                    Continue in Simulation Mode
                  </button>
                </div>
              ) : error && <p className="text-[10px] text-red-400">{error}</p>}
            </div>
            <p className="text-[10px] text-gray-600 leading-relaxed">
              Get your App ID from the <a href="https://developers.deriv.com" target="_blank" className="text-[#00d4aa] hover:underline">Deriv Developer Dashboard</a>. Generate a PAT token in Deriv Settings with <b>Read</b> + <b>Trade</b> scopes.
            </p>
            <button
              onClick={handleLogin}
              disabled={authorizing}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all duration-200 hover:translate-y-[-1px] disabled:opacity-50"
              style={{
                background: isReal
                  ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                  : 'linear-gradient(135deg, #00d4aa, #00b8a9)',
                color: isReal ? 'white' : '#0d1117',
                boxShadow: `0 0 20px ${isReal ? 'rgba(239,68,68,0.4)' : 'rgba(0,212,170,0.4)'}, 0 0 40px ${isReal ? 'rgba(239,68,68,0.15)' : 'rgba(0,212,170,0.15)'}`,
              }}
            >
              {authorizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              {authorizing ? 'Fetching Accounts...' : 'Connect'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

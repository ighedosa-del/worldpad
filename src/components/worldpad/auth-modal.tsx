'use client';

import { useState, useEffect } from 'react';
import { useWorldpadStore } from '@/lib/store';
import { authorizeViaWS } from '@/lib/deriv-ws';
import { LogIn, X, Key, Loader2, CheckCircle2, Shield, AlertTriangle } from 'lucide-react';

type AccountMode = 'demo' | 'real';

export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    accountMode, setAccountMode, demoToken, realToken,
    setDemoToken, setRealToken,
    isAuthorized, isAuthorizing, setAuthorizing,
    setAccountInfo, setBalance, setIsAuthorized,
  } = useWorldpadStore();

  const [mode, setMode] = useState<AccountMode>(accountMode);
  const [inputToken, setInputToken] = useState('');
  const [error, setError] = useState('');

  // Sync local mode with store
  useEffect(() => { setMode(accountMode); }, [accountMode]);
  // Pre-fill input with saved token for current mode
  useEffect(() => {
    setInputToken(mode === 'demo' ? demoToken : realToken);
  }, [mode, demoToken, realToken]);

  if (!open) return null;

  const isReal = mode === 'real';
  const modeColor = isReal ? '#ef4444' : '#00d4aa';
  const modeLabel = isReal ? 'REAL' : 'DEMO';
  const savedToken = isReal ? realToken : demoToken;

  const handleLogin = async () => {
    if (!inputToken.trim()) { setError('Enter your API token'); return; }
    setError('');
    setAuthorizing(true);
    try {
      const result = await authorizeViaWS(inputToken.trim());
      // Save token for this mode
      if (isReal) {
        setRealToken(inputToken.trim());
      } else {
        setDemoToken(inputToken.trim());
      }
      setAccountMode(mode);
      setIsAuthorized(true);
      setAccountInfo({
        fullname: result.fullname,
        loginid: result.loginid,
        balance: result.balance,
        currency: result.currency,
      });
      setBalance(result.balance);
      onClose();
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.includes('WebSocket') || msg.includes('timeout') || msg.includes('Cannot create')) {
        setError('NETWORK_BLOCKED');
      } else {
        setError(msg);
      }
    } finally {
      setAuthorizing(false);
    }
  };

  const handleModeSwitch = (newMode: AccountMode) => {
 if (newMode === mode) return;
    setMode(newMode);
    setError('');
    // If already have a saved token for this mode, auto-connect
    const token = newMode === 'demo' ? demoToken : realToken;
    if (token) {
      setInputToken(token);
    }
  };

  const handleLogout = () => {
    if (isReal) {
      setRealToken('');
    } else {
      setDemoToken('');
    }
    setIsAuthorized(false);
    setAccountInfo(null);
    setInputToken('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-sm rounded-2xl p-6 relative" style={{
        background: '#161b22',
        border: `1px solid ${isReal ? 'rgba(239,68,68,0.15)' : 'rgba(0,212,170,0.15)'}`,
        boxShadow: `0 0 60px rgba(0,0,0,0.5), 0 0 30px ${isReal ? 'rgba(239,68,68,0.05)' : 'rgba(0,212,170,0.05)'}`,
      }}>
        {/* Close button */}
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
            <p className="text-[10px] text-gray-500">Enter your Deriv API token</p>
          </div>
        </div>

        {/* ===== REAL / DEMO TOGGLE ===== */}
        <div className="flex rounded-xl overflow-hidden mb-5" style={{
          background: '#000000',
          border: `1px solid rgba(255,255,255,0.08)`,
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
            {demoToken && !isReal && <span className="w-1.5 h-1.5 rounded-full bg-[#0d1117]" />}
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
            {realToken && isReal && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
          </button>
        </div>

        {/* Mode warning for real */}
        {isReal && (
          <div className="rounded-lg p-2.5 mb-4 flex items-start gap-2" style={{
            background: 'rgba(239,68,68,0.06)',
            border: '1px solid rgba(239,68,68,0.15)',
          }}>
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
            <p className="text-[10px] text-red-400/80 leading-relaxed">You are connecting with <span className="font-bold text-red-400">real funds</span>. Trades will use actual money from your Deriv account.</p>
          </div>
        )}

        {/* Demo reassurance */}
        {!isReal && (
          <div className="rounded-lg p-2.5 mb-4 flex items-start gap-2" style={{
            background: 'rgba(0,212,170,0.04)',
            border: '1px solid rgba(0,212,170,0.12)',
          }}>
            <Shield className="w-3.5 h-3.5 text-[#00d4aa] mt-0.5 shrink-0" />
            <p className="text-[10px] text-[#00d4aa]/70 leading-relaxed"><span className="font-bold text-[#00d4aa]">Demo mode</span> — trades use virtual funds. No real money at risk.</p>
          </div>
        )}

        {isAuthorized && savedToken ? (
          /* Logged in state */
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
        ) : (
          /* Login form */
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
                {modeLabel} API Token
              </label>
              <input
                type="password"
                value={inputToken}
                onChange={(e) => setInputToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder={`paste your ${mode.toLowerCase()} token here...`}
                className="w-full text-white text-xs px-4 py-3 rounded-xl outline-none transition-all duration-200"
                style={{
                  background: '#000000',
                  border: `1px solid ${error ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.1)'}`,
                  focus: { borderColor: `${modeColor}40` },
                }}
              />
              {error === 'NETWORK_BLOCKED' ? (
                <div className="rounded-lg p-3 flex flex-col gap-2" style={{
                  background: 'rgba(234,179,8,0.06)',
                  border: '1px solid rgba(234,179,8,0.2)',
                }}>
                  <p className="text-[10px] text-yellow-400 font-medium">Cannot reach Deriv servers.</p>
                  <p className="text-[10px] text-gray-400">All trading features work in simulation mode.</p>
                  <button
                    onClick={() => { setError(''); onClose(); }}
                    className="w-full py-2 rounded-lg text-[10px] font-bold text-yellow-400 transition-all hover:brightness-110"
                    style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)' }}
                  >
                    Continue in Simulation Mode
                  </button>
                </div>
              ) : error && <p className="text-[10px] text-red-400">{error}</p>}
            </div>
            <p className="text-[10px] text-gray-600 leading-relaxed">
              Get your token from Deriv &gt; Settings &gt; API Token. Use a Read+Trade scope token for your {mode.toLowerCase()} account.
            </p>
            <button
              onClick={handleLogin}
              disabled={isAuthorizing}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all duration-200 hover:translate-y-[-1px] disabled:opacity-50"
              style={{
                background: isReal
                  ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                  : 'linear-gradient(135deg, #00d4aa, #00b8a9)',
                color: isReal ? 'white' : '#0d1117',
                boxShadow: `0 0 20px ${isReal ? 'rgba(239,68,68,0.4)' : 'rgba(0,212,170,0.4)'}, 0 0 40px ${isReal ? 'rgba(239,68,68,0.15)' : 'rgba(0,212,170,0.15)'}`,
              }}
            >
              {isAuthorizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              {isAuthorizing ? 'Connecting...' : `Connect ${modeLabel}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
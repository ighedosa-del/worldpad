'use client';

import { useState } from 'react';
import { useWorldpadStore } from '@/lib/store';
import { authorizeViaWS } from '@/lib/deriv-ws';
import { LogIn, X, Key, Loader2, CheckCircle2 } from 'lucide-react';

export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { apiToken, setApiToken, isAuthorized, isAuthorizing, setAuthorizing, setAccountInfo, setBalance, setIsAuthorized } = useWorldpadStore();
  const [inputToken, setInputToken] = useState(apiToken);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleLogin = async () => {
    if (!inputToken.trim()) { setError('Enter your API token'); return; }
    setError('');
    setAuthorizing(true);
    try {
      // Authorize directly via WebSocket — no server-side REST proxy needed
      const result = await authorizeViaWS(inputToken.trim());
      setApiToken(inputToken.trim());
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
      console.error('[AuthModal] Auth failed:', msg);
      if (msg.includes('WebSocket') || msg.includes('timeout') || msg.includes('Cannot create')) {
        setError('NETWORK_BLOCKED');
      } else {
        setError(msg);
      }
    } finally {
      setAuthorizing(false);
    }
  };

  const handleLogout = () => {
    setApiToken('');
    setIsAuthorized(false);
    setAccountInfo(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-sm rounded-2xl p-6 relative" style={{
        background: '#161b22',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 0 60px rgba(0,0,0,0.5), 0 0 30px rgba(0,212,170,0.05)',
      }}>
        {/* Close button */}
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{
            background: 'linear-gradient(135deg, rgba(0,212,170,0.15), rgba(224,64,251,0.15))',
            border: '1px solid rgba(0,212,170,0.2)',
          }}>
            <Key className="w-5 h-5 text-[#00d4aa]" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Connect Account</h2>
            <p className="text-[10px] text-gray-500">Enter your Deriv API token</p>
          </div>
        </div>

        {isAuthorized ? (
          /* Logged in state */
          <div className="flex flex-col gap-4">
            <div className="rounded-xl p-4" style={{
              background: 'rgba(0,212,170,0.04)',
              border: '1px solid rgba(0,212,170,0.15)',
            }}>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                <span className="text-xs font-bold text-green-400">Connected</span>
              </div>
              <p className="text-xs text-gray-400">Account active — trading is enabled</p>
            </div>
            <button onClick={handleLogout} className="w-full py-2.5 rounded-xl text-xs font-bold text-white transition-all hover:brightness-110" style={{
              background: 'linear-gradient(135deg, #dc2626, #ef4444)',
              boxShadow: '0 0 12px rgba(220,38,38,0.3)',
            }}>
              Disconnect
            </button>
          </div>
        ) : (
          /* Login form */
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">API Token</label>
              <input
                type="password"
                value={inputToken}
                onChange={(e) => setInputToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="paste your token here..."
                className="w-full text-white text-xs px-4 py-3 rounded-xl outline-none transition-all duration-200 focus:border-[rgba(0,212,170,0.4)]"
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
                <p className="text-[10px] text-gray-400">All trading features work in simulation mode — no API token needed.</p>
                <button
                  onClick={() => { setError(''); onClose(); }}
                  className="w-full py-2 rounded-lg text-[10px] font-bold text-yellow-400 transition-all hover:brightness-110"
                  style={{
                    background: 'rgba(234,179,8,0.1)',
                    border: '1px solid rgba(234,179,8,0.3)',
                  }}
                >
                  Continue in Simulation Mode
                </button>
              </div>
            ) : error && <p className="text-[10px] text-red-400">{error}</p>}
            </div>
            <p className="text-[10px] text-gray-600 leading-relaxed">
              Get your token from Deriv &gt; Settings &gt; API Token. Use a Read+Trade scope token.
            </p>
            <button
              onClick={handleLogin}
              disabled={isAuthorizing}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-[#0d1117] transition-all duration-200 hover:translate-y-[-1px] disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #00d4aa, #00b8a9)',
                boxShadow: '0 0 20px rgba(0,212,170,0.4), 0 0 40px rgba(0,212,170,0.15)',
              }}
            >
              {isAuthorizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              {isAuthorizing ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
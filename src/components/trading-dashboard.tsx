'use client';

import { useEffect, useRef, useState } from 'react';
import { useBotStore } from '@/lib/bot/store';
import { MARKETS } from '@/lib/bot/engine';
import {
  Play, Square, Wifi, WifiOff, Zap, Shield, Terminal, ChevronDown, ChevronUp,
  BarChart3, TrendingUp, TrendingDown, Plus, Trash2, Settings, Activity, X,
} from 'lucide-react';

// === HELPERS ===
const fmt = (n: number, d = 2) => (n >= 0 ? '+' : '') + n.toFixed(d);
const ts = () => new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

function getLogColor(l: string) {
  if (l.includes('WIN')) return '#00ff88';
  if (l.includes('LOSS')) return '#ff5555';
  if (l.includes('STOPPED') || l.includes('STOP LOSS') || l.includes('TAKE PROFIT')) return '#f59e0b';
  if (l.includes('STARTED') || l.includes('Connected') || l.includes('Authorized')) return '#22d3ee';
  if (l.includes('FAILED') || l.includes('Error') || l.includes('error')) return '#ef4444';
  if (l.includes('DIGITDIFF')) return '#a78bfa';
  return '#6b7280';
}

// === ACCOUNT MODAL ===
function AccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [token, setToken] = useState('');
  const [adding, setAdding] = useState(false);
  const { addAccount, accounts, activeAccountId, logs, switchAccount } = useBotStore();
  const errLogs = logs.filter(l => l.includes('[ERROR]')).slice(-3);

  const handleAdd = async () => {
    if (!token.trim()) return;
    setAdding(true);
    const acc = await addAccount(token.trim());
    setAdding(false);
    if (acc) { setToken(''); onClose(); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0f131a] border border-white/10 rounded-2xl w-full max-w-md mx-4 p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-cyan-400" />
            <h2 className="text-white text-lg font-bold">Add Account</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-gray-400 text-sm mb-4">Paste your Deriv PAT token. Both demo and real accounts are detected automatically.</p>
        <div className="relative mb-3">
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="pat_xxxxxxxxxxxxx..."
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-600 text-sm font-mono focus:outline-none focus:border-cyan-500/50 transition-all"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            disabled={adding}
          />
          <button
            onClick={handleAdd}
            disabled={adding || !token.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-sm font-bold hover:bg-cyan-500/30 transition-colors disabled:opacity-40"
          >
            {adding ? 'Verifying...' : 'Add'}
          </button>
        </div>
        {errLogs.length > 0 && (
          <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            {errLogs.map((l, i) => <div key={i} className="text-red-400 text-xs font-mono">{l}</div>)}
          </div>
        )}
        {accounts.length > 0 && (
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Saved Accounts</div>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {accounts.map(acc => (
                <div key={acc.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${activeAccountId === acc.id ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'}`}>
                  <div className={`w-2 h-2 rounded-full ${acc.accountType === 'real' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-white truncate">{acc.label}</div>
                    <div className="text-xs text-gray-500 font-mono">{acc.loginid} · $${acc.balance.toFixed(2)} {acc.currency}</div>
                  </div>
                  <button onClick={() => { onClose(); switchAccount(acc.id); }} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeAccountId === acc.id ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}>
                    {activeAccountId === acc.id ? 'Active' : 'Switch'}
                  </button>
                  <button onClick={() => { useBotStore.getState().removeAccount(acc.id); }} className="p-1 text-gray-600 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// === HEADER ===
function Header() {
  const { status, activeAuth, accounts, running, stop } = useBotStore();
  const [showAccounts, setShowAccounts] = useState(false);
  const isOnline = status !== 'idle' && status !== 'error' && status !== 'connecting';
  const accType = activeAuth?.accountType || '---';
  const accColor = accType === 'real' ? '#ef4444' : accType === 'demo' ? '#00d4aa' : '#6b7280';

  return (
    <header className="border-b border-white/[0.06] bg-[#0a0e17]/90 backdrop-blur-xl sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center shadow-[0_0_16px_rgba(6,182,212,0.3)]">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="text-base font-black bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">WORLDPAD</span>
          </div>
          {/* Account selector */}
          <button
            onClick={() => setShowAccounts(!showAccounts)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all cursor-pointer hover:bg-white/5"
            style={{ borderColor: `${accColor}40`, background: `${accColor}10` }}
          >
            <div className={`w-2 h-2 rounded-full shadow-[0_0_6px]`} style={{ background: accColor }} />
            <span className="text-sm font-bold" style={{ color: accColor }}>{accType.toUpperCase()}</span>
            <span className="text-xs text-gray-500 font-mono">{activeAuth?.loginid || '---'}</span>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${showAccounts ? 'rotate-180' : ''}`} />
          </button>
          {/* Balance */}
          {activeAuth && (
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/5">
              <DollarSign className="w-3.5 h-3.5 text-green-400" />
              <span className="text-sm font-bold text-white font-mono">${activeAuth.balance.toFixed(2)}</span>
              <span className="text-xs text-gray-500">{activeAuth.currency}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isOnline && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
              <span className="text-[10px] text-green-400 font-medium hidden sm:inline">Live</span>
            </div>
          )}
          {!isOnline && (
            <div className="flex items-center gap-1.5">
              <WifiOff className="w-3.5 h-3.5 text-gray-600" />
              <span className="text-[10px] text-gray-600 font-medium hidden sm:inline">Offline</span>
            </div>
          )}
          {running ? (
            <button onClick={stop} className="flex items-center gap-1.5 px-5 py-2 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all">
              <Square className="w-3.5 h-3.5" /> STOP
            </button>
          ) : (
            <button onClick={() => setShowAccounts(true)} className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500/80 to-purple-500/80 border border-cyan-400/20 text-white text-xs font-bold hover:from-cyan-500 hover:to-purple-500 transition-all shadow-[0_0_20px_rgba(6,182,212,0.15)]">
              <Play className="w-3.5 h-3.5" /> START
            </button>
          )}
        </div>
      </div>
      {/* Account dropdown */}
      {showAccounts && <AccountModal open={showAccounts} onClose={() => setShowAccounts(false)} />}
    </header>
  );
}

// === STATS BAR ===
function StatsBar() {
  const { running, cycles, totalTrades, totalProfit, wins, losses, totalTicks, status } = useBotStore();
  if (!running && totalTrades === 0) return null;
  const wr = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';
  const statusCfg: Record<string, { label: string; color: string }> = {
    idle: { label: 'IDLE', color: '#6b7280' },
    connecting: { label: 'CONNECTING', color: '#f59e0b' },
    scanning: { label: 'SCANNING', color: '#3b82f6' },
    trading: { label: 'TRADING', color: '#22c55e' },
    paused: { label: 'PAUSED', color: '#f59e0b' },
    error: { label: 'ERROR', color: '#ef4444' },
  };
  const st = statusCfg[status] || statusCfg.idle;
  const stats = [
    { label: 'CYCLES', value: cycles.toString(), color: '#e2e8f0' },
    { label: 'TRADES', value: totalTrades.toString(), color: '#e2e8f0' },
    { label: 'P/L', value: fmt(totalProfit), color: totalProfit >= 0 ? '#22c55e' : '#ef4444' },
    { label: 'WIN RATE', value: `${wr}%`, color: parseFloat(wr) >= 50 ? '#22c55e' : '#ef4444' },
    { label: 'TICKS', value: totalTicks.toString(), color: '#22d3ee' },
  ];
  return (
    <div className="flex items-center gap-3 sm:gap-4 px-3 py-2 rounded-xl border border-white/[0.06] bg-[#0f131a] overflow-x-auto">
      {stats.map((s, i) => (
        <div key={s.label} className="flex items-center gap-3 shrink-0">
          {i > 0 && <div className="w-px h-5 bg-white/[0.06]" />}
          <div className="flex flex-col items-center">
            <span className="text-[9px] text-gray-500 uppercase tracking-wider font-medium">{s.label}</span>
            <span className="text-sm font-bold font-mono" style={{ color: s.color }}>{s.value}</span>
          </div>
        </div>
      ))}
      <div className="ml-auto shrink-0 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border" style={{ background: `${st.color}15`, color: st.color, borderColor: `${st.color}30`, boxShadow: `0 0 12px ${st.color}20` }}>
        {st.label}
      </div>
    </div>
  );
}

// === MARKET CARD ===
function MarketCard({ symbol, name, type }: { symbol: string; name: string; type: string }) {
  const market = useBotStore(s => s.markets[symbol]);
  if (!market) return null;
  const { distributionPct, tickCount, lastTick, onCooldown } = market;
  const hasData = tickCount >= 30;
  const dist = distributionPct;
  let minPct = Infinity, minD = 0;
  for (let i = 0; i < 10; i++) { if (dist[i] < minPct) { minPct = dist[i]; minD = i; } }
  const typeColor = type === 'STD' ? '#3b82f6' : '#ef4444';
  return (
    <div className={`rounded-xl border bg-[#161b26] p-4 transition-all ${onCooldown ? 'border-yellow-500/20' : 'border-white/[0.06]'}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white truncate">{name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold" style={{ background: `${typeColor}15`, color: typeColor, border: `${typeColor}30` }}>{type}</span>
        </div>
        <span className="text-[10px] font-mono text-gray-500">{tickCount}</span>
      </div>
      <div className="flex items-center gap-3 mb-2">
        <span className={`text-3xl font-black font-mono ${lastTick !== null ? 'text-white' : 'text-gray-700'}`}>{lastTick !== null ? lastTick.digit : '-'}</span>
        <div className="flex-1">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider">Signal</div>
          <div className="text-[11px] font-bold font-mono" style={{ color: hasData ? '#a78bfa' : '#374151' }}>
            {hasData ? `DIGITDIFF d${minD} (${minPct.toFixed(1)}%)` : 'Collecting...'}
          </div>
        </div>
      </div>
      {/* Distribution bars */}
      {hasData ? (
        <div className="flex gap-px h-5">
          {dist.map((pct, i) => (
            <div key={i} className="flex-1 rounded-sm relative" title={`d${i}: ${pct.toFixed(1)}%`} style={{ background: i === minD ? 'rgba(167,139,250,0.3)' : 'rgba(255,255,255,0.04)' }}>
              <div className="absolute inset-x-0 bottom-0 rounded-sm" style={{ height: `${Math.max(pct * 6, 4)}%`, background: i === minD ? '#a78bfa' : 'rgba(255,255,255,0.12)' }} />
            </div>
          ))}
        </div>
      ) : null}
      {onCooldown && <div className="text-[9px] text-yellow-500 font-medium">Cooldown</div>}
    </div>
  );
}

// === MARKET GRID ===
function MarketGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-5 gap-3">
      {MARKETS.map(m => <MarketCard key={m.symbol} symbol={m.symbol} name={m.name} type={m.type} />)}
    </div>
  );
}

// === TRADE HISTORY ===
function TradeHistory() {
  const { trades } = useBotStore();
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0f131a]">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">Trade History</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">{trades.length}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />
      </button>
      {open && (
        <div className="border-t border-white/[0.06] max-h-72 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#333 transparent' }}>
          {trades.length === 0 ? (
            <div className="px-4 py-6 text-center text-gray-600 text-xs">No trades yet</div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {trades.slice(0, 30).map(t => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02]">
                  {t.won ? <TrendingUp className="w-4 h-4 text-green-400 shrink-0" /> : <TrendingDown className="w-4 h-4 text-red-400 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-white">{t.name}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: t.won ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', color: t.won ? '#22c55e' : '#ef4444' }}>DIGITDIFF d{t.barrier}</span>
                    </div>
                    <div className="text-[9px] text-gray-600 font-mono">{t.contractId}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-bold font-mono" style={{ color: t.profit >= 0 ? '#22c55e' : '#ef4444' }}>{fmt(t.profit)}</div>
                    <div className="text-[9px] text-gray-600 font-mono">{ts()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// === BOT LOGS ===
function BotLogs() {
  const { logs } = useBotStore();
  const [open, setOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recent = logs.slice(-100);
  useEffect(() => { if (scrollRef.current && open) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [recent.length, open]);
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0f131a]">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-green-400" />
          <span className="text-sm font-semibold text-white">Bot Logs</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-green-500/10 text-green-400 border border-green-500/20">{logs.length}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />
      </button>
      {open && (
        <div ref={scrollRef} className="max-h-64 overflow-y-auto px-4 pb-4 font-mono text-[10px] leading-relaxed bg-black/30" style={{ scrollbarWidth: 'thin', scrollbarColor: '#333 transparent' }}>
          {recent.length === 0 ? <div className="text-gray-600 py-2">Waiting...</div> : recent.map((l, i) => <div key={i} style={{ color: getLogColor(l) }} className="py-0.5 whitespace-pre-wrap break-all">{l}</div>)}
        </div>
      )}
    </div>
  );
}

// === CONFIG ===
function ConfigPanel() {
  const { config, setConfig } = useBotStore();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0f131a]">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-semibold text-white">Configuration</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />
      </button>
      {open && (
        <div className="border-t border-white/[0.06] p-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[9px] text-gray-500 uppercase tracking-wider block mb-1">Stake ($)</label>
              <input type="number" value={config.stake} onChange={e => setConfig({ stake: parseFloat(e.target.value) || 0.35 })} min={0.35} step={0.05} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm font-mono focus:outline-none focus:border-purple-500/50" />
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase tracking-wider block mb-1">Stop Loss ($)</label>
              <input type="number" value={config.stopLoss} onChange={e => setConfig({ stopLoss: parseFloat(e.target.value) || 0 })} min={0} step={1} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm font-mono focus:outline-none focus:border-red-500/50" />
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase tracking-wider block mb-1">Take Profit ($)</label>
              <input type="number" value={config.takeProfit} onChange={e => setConfig({ takeProfit: parseFloat(e.target.value) || 0 })} min={0} step={1} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm font-mono focus:outline-none focus:border-green-500/50" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// === MAIN ===
export function TradingDashboard() {
  const { status, totalTicks } = useBotStore();
  const isOnline = status !== 'idle' && status !== 'error';
  const showTip = totalTicks > 0 && totalTicks < 300;
  return (
    <div className="min-h-screen bg-[#010409] text-white flex flex-col">
      <Header />
      <main className="flex-1 max-w-[1600px] mx-auto w-full p-4 space-y-3 overflow-y-auto">
        {showTip && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/[0.08] border border-blue-500/15">
            <Activity className="w-4 h-4 text-blue-400 animate-pulse" />
            <span className="text-xs text-blue-300">Collecting data — signals appear after ~30 ticks per market. Total: {totalTicks}</span>
          </div>
        )}
        <StatsBar />
        <ConfigPanel />
        <MarketGrid />
        <div className="space-y-3">
          <TradeHistory />
          <BotLogs />
        </div>
      </main>
    </div>
  );
}

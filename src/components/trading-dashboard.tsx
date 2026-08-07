'use client';

import { useEffect, useRef, useState } from 'react';
import { useBotStore } from '@/lib/bot/store';
import { MARKETS } from '@/lib/bot/engine';
import {
  Play, Square, Wifi, WifiOff, Activity, DollarSign,
  TrendingUp, TrendingDown, Clock, Zap, Shield, Terminal,
  ChevronDown, ChevronUp, BarChart3, Target, AlertTriangle,
} from 'lucide-react';

const TOKEN = process.env.NEXT_PUBLIC_DERIV_TOKEN || '';

// === Status Badge ===
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; bg: string; glow: string; label: string }> = {
    idle:     { color: '#6b7280', bg: 'rgba(107,114,128,0.15)', glow: 'none', label: 'IDLE' },
    connecting:{ color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', glow: '0 0 12px rgba(245,158,11,0.3)', label: 'CONNECTING' },
    scanning: { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', glow: '0 0 12px rgba(59,130,246,0.3)', label: 'SCANNING' },
    trading:  { color: '#22c55e', bg: 'rgba(34,197,94,0.15)',  glow: '0 0 16px rgba(34,197,94,0.4)',  label: 'TRADING' },
    paused:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', glow: '0 0 12px rgba(245,158,11,0.3)', label: 'PAUSED' },
    error:    { color: '#ef4444', bg: 'rgba(239,68,68,0.15)',  glow: '0 0 12px rgba(239,68,68,0.3)', label: 'ERROR' },
  };
  const c = config[status] || config.idle;
  return (
    <span
      className="px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider"
      style={{ background: c.bg, color: c.color, border: `1px solid ${c.color}30`, boxShadow: c.glow }}
    >
      {status === 'trading' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 animate-pulse" />}
      {c.label}
    </span>
  );
}

// === Connection Panel ===
function ConnectionPanel() {
  const auth = useBotStore(s => s.auth);
  const status = useBotStore(s => s.status);
  const mode = auth?.isVirtual ? 'DEMO' : auth ? 'REAL' : '---';
  const modeColor = auth?.isVirtual ? '#00d4aa' : auth ? '#ef4444' : '#6b7280';
  const isConnected = status !== 'idle' && status !== 'error';

  return (
    <div className="rounded-xl border border-white/10 bg-[#0d1117] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4" style={{ color: isConnected ? '#22c55e' : '#6b7280' }} />
          <span className="text-sm font-semibold text-white">Connection</span>
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider"
            style={{ background: `${modeColor}20`, color: modeColor, border: `1px solid ${modeColor}40` }}>
            {mode}
          </span>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <InfoBox label="Account" value={auth?.loginid || '---'} />
        <InfoBox label="Balance" value={auth ? `$${auth.balance.toFixed(2)} ${auth.currency}` : '---'} valueColor={auth ? '#22c55e' : '#6b7280'} />
        <InfoBox label="Token" value={TOKEN ? TOKEN.slice(0, 12) + '...' : 'MISSING'} valueColor={TOKEN ? '#22c55e' : '#ef4444'} />
        <InfoBox label="WebSocket" value={isConnected ? 'CONNECTED' : 'DISCONNECTED'} valueColor={isConnected ? '#22c55e' : '#ef4444'} />
      </div>
    </div>
  );
}

function InfoBox({ label, value, valueColor = '#e2e8f0' }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="rounded-lg p-2 bg-white/[0.03] border border-white/5">
      <div className="text-[9px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-xs font-bold font-mono mt-0.5 truncate" style={{ color: valueColor }}>{value}</div>
    </div>
  );
}

// === Stats Bar ===
function StatsBar() {
  const { totalTrades, totalProfit, wins, losses, currentCycle, running, stake } = useBotStore();
  const wr = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';

  if (!running && totalTrades === 0) return null;

  return (
    <div className="flex items-center gap-3 sm:gap-5 px-4 py-2.5 rounded-xl border border-white/10 bg-[#0d1117] overflow-x-auto">
      <Stat label="Cycles" value={currentCycle.toString()} />
      <Divider />
      <Stat label="Trades" value={totalTrades.toString()} />
      <Divider />
      <Stat label="P/L" value={`${totalProfit >= 0 ? '+' : ''}$${totalProfit.toFixed(2)}`} color={totalProfit >= 0 ? '#22c55e' : '#ef4444'} />
      <Divider />
      <Stat label="Win Rate" value={`${wr}%`} color={parseFloat(wr) >= 50 ? '#22c55e' : '#ef4444'} />
      <Divider />
      <Stat label="W/L" value={`${wins}/${losses}`} />
      <Divider />
      <Stat label="Stake" value={`$${stake.toFixed(2)}`} color="#a78bfa" />
    </div>
  );
}

function Stat({ label, value, color = '#e2e8f0' }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 shrink-0">
      <span className="text-[9px] text-gray-500 uppercase tracking-wider font-medium">{label}</span>
      <span className="text-sm font-bold font-mono" style={{ color }}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="w-px h-6 bg-white/10 shrink-0" />;
}

// === Market Grid ===
function MarketGrid() {
  const markets = useBotStore(s => s.markets);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-5 gap-2">
      {MARKETS.map(m => {
        const market = markets[m.symbol];
        if (!market) return null;
        const lastDigit = market.lastTick?.digit;
        const dist = market.distributionPct;
        const hasData = market.tickCount >= 30;

        // Find least frequent digit
        let minPct = Infinity, minDigit = 0;
        for (let i = 0; i < 10; i++) {
          if (dist[i] < minPct) { minPct = dist[i]; minDigit = i; }
        }

        return (
          <div key={m.symbol} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-white truncate">{m.name}</span>
              <span className="text-[10px] font-mono text-gray-500">{market.tickCount}</span>
            </div>

            {/* Last digit */}
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-2xl font-black font-mono ${lastDigit !== null ? 'text-white' : 'text-gray-700'}`}>{
                lastDigit !== null ? lastDigit : '-'
              }</span>
              <div className="flex-1">
                <div className="text-[9px] text-gray-500">Signal</div>
                <div className="text-[11px] font-bold font-mono" style={{ color: hasData ? '#a78bfa' : '#374151' }}>
                  {hasData ? `DIGITDIFF d${minDigit}` : 'Collecting...'}
                </div>
              </div>
            </div>

            {/* Mini distribution bars */}
            {hasData && (
              <div className="flex gap-px h-4">
                {dist.map((pct, i) => (
                  <div key={i} className="flex-1 rounded-sm relative" style={{ background: i === minDigit ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.06)' }} title={`d${i}: ${pct.toFixed(1)}%`}>
                    <div className="absolute inset-x-0 bottom-0 rounded-sm" style={{ height: `${Math.max(pct * 5, 3)}%`, background: i === minDigit ? '#a78bfa' : 'rgba(255,255,255,0.15)' }} />
                  </div>
                ))}
              </div>
            )}

            {market.onCooldown && (
              <div className="text-[9px] text-yellow-500 font-medium mt-1.5">Cooldown</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// === Trade History ===
function TradeHistory() {
  const trades = useBotStore(s => s.trades);
  const [open, setOpen] = useState(true);
  const recent = trades.slice(0, 20);

  return (
    <div className="rounded-xl border border-white/10 bg-[#0d1117]">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">Trade History</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">{trades.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {trades.length > 0 && (
            <span className="text-xs font-mono" style={{ color: trades[0]?.profit >= 0 ? '#22c55e' : '#ef4444' }}>
              {trades[0]?.profit >= 0 ? '+' : ''}${trades.reduce((sum, t) => sum + t.profit, 0).toFixed(2)}
            </span>
          )}
          {open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </div>
      </button>
      {open && (
        <div className="border-t border-white/5 max-h-72 overflow-y-auto">
          {recent.length === 0 ? (
            <div className="px-4 py-6 text-center text-gray-600 text-xs">No trades yet. Start the bot to begin trading.</div>
          ) : (
            <div className="divide-y divide-white/5">
              {recent.map(t => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  {t.won
                    ? <TrendingUp className="w-4 h-4 text-green-400 shrink-0" />
                    : <TrendingDown className="w-4 h-4 text-red-400 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-white">{t.name}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                        style={{ background: t.won ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', color: t.won ? '#22c55e' : '#ef4444' }}>
                        DIGITDIFF d{t.barrier}
                      </span>
                    </div>
                    <div className="text-[9px] text-gray-600 font-mono">{t.contractId}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-bold font-mono" style={{ color: t.profit >= 0 ? '#22c55e' : '#ef4444' }}>
                      {t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}
                    </div>
                    <div className="text-[9px] text-gray-600">${t.stake.toFixed(2)}</div>
                  </div>
                  <span className="text-[9px] text-gray-600 font-mono shrink-0 w-14 text-right">
                    {new Date(t.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// === Bot Logs ===
function BotLogs() {
  const logs = useBotStore(s => s.logs);
  const [open, setOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recent = logs.slice(-80);

  useEffect(() => {
    if (scrollRef.current && open) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [recent.length, open]);

  return (
    <div className="rounded-xl border border-white/10 bg-[#0d1117]">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-green-400" />
          <span className="text-sm font-semibold text-white">Bot Logs</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-green-500/10 text-green-400 border border-green-500/20">{logs.length}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
      </button>
      {open && (
        <div ref={scrollRef} className="max-h-60 overflow-y-auto px-4 pb-4 font-mono text-[10px] leading-relaxed bg-black/30"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#333 transparent' }}>
          {recent.length === 0 ? (
            <div className="text-gray-600 py-2">Waiting for connection...</div>
          ) : (
            recent.map((log, i) => {
              let color = '#9ca3af';
              if (log.includes('WIN')) color = '#22c55e';
              else if (log.includes('LOSS')) color = '#f87171';
              else if (log.includes('STOPPED') || log.includes('STOP LOSS') || log.includes('TAKE PROFIT')) color = '#f59e0b';
              else if (log.includes('STARTED') || log.includes('Connected') || log.includes('Authorized')) color = '#60a5fa';
              else if (log.includes('FAILED') || log.includes('Error') || log.includes('error')) color = '#ef4444';
              else if (log.includes('DIGITDIFF')) color = '#a78bfa';
              return <div key={i} style={{ color }} className="py-0.5 whitespace-pre-wrap break-all">{log}</div>;
            })
          )}
        </div>
      )}
    </div>
  );
}

// === Config Panel ===
function ConfigPanel() {
  const { stake, stopLoss, takeProfit, setStake, setStopLoss, setTakeProfit } = useBotStore();

  return (
    <div className="rounded-xl border border-white/10 bg-[#0d1117] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-semibold text-white">Configuration</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <ConfigInput label="Stake ($)" value={stake} onChange={(v) => setStake(v)} min={0.35} step={0.05} color="#a78bfa" />
        <ConfigInput label="Stop Loss ($)" value={stopLoss} onChange={(v) => setStopLoss(v)} min={0} step={1} color="#ef4444" />
        <ConfigInput label="Take Profit ($)" value={takeProfit} onChange={(v) => setTakeProfit(v)} min={0} step={1} color="#22c55e" />
      </div>
    </div>
  );
}

function ConfigInput({ label, value, onChange, min, step, color }: {
  label: string; value: number; onChange: (v: number) => void; min: number; step: number; color: string;
}) {
  return (
    <div>
      <label className="text-[9px] text-gray-500 uppercase tracking-wider block mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Math.max(min, parseFloat(e.target.value) || min))}
        min={min}
        step={step}
        className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm font-mono
          focus:outline-none focus:ring-1 focus:ring-offset-0 transition-colors"
        style={{ '--tw-ring-color': color } as React.CSSProperties}
      />
    </div>
  );
}

// === MAIN DASHBOARD ===
export function TradingDashboard() {
  const { status, running, connect, start, stop } = useBotStore();
  const [connecting, setConnecting] = useState(false);

  const handleToggle = async () => {
    if (running) {
      stop();
    } else {
      if (status === 'idle' || status === 'error') {
        if (!TOKEN) {
          alert('No token configured. Set NEXT_PUBLIC_DERIV_TOKEN in .env.local');
          return;
        }
        setConnecting(true);
        try {
          await connect(TOKEN);
          start();
        } catch (err) {
          console.error('Connect failed:', err);
        } finally {
          setConnecting(false);
        }
      } else {
        start();
      }
    }
  };

  const isConnected = status !== 'idle' && status !== 'error';

  return (
    <div className="min-h-screen bg-[#010409] text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#0d1117]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20">
              <Zap className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-[10px] font-bold text-purple-400">DERIV BOT</span>
            </div>
            <h1 className="text-white text-lg font-bold hidden sm:block">Trading Bot</h1>
            {isConnected ? (
              <div className="flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-green-400" />
                <span className="text-[10px] text-green-400 font-medium">Live</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <WifiOff className="w-3.5 h-3.5 text-gray-500" />
                <span className="text-[10px] text-gray-500 font-medium">Offline</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <button
              onClick={handleToggle}
              disabled={connecting}
              className={`flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-bold transition-all duration-200 disabled:opacity-50 ${
                running
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                  : 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30'
              }`}
            >
              {connecting ? (
                <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : running ? (
                <Square className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              {running ? 'STOP' : 'START'}
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-[1600px] mx-auto w-full p-4 space-y-3 overflow-y-auto">
        <ConnectionPanel />
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

'use client';

import { useWorldpadStore } from '@/lib/store';
import { useState, useCallback } from 'react';
import {
  Save, FolderOpen, BarChart3, Undo2, Redo2, RefreshCw,
  ZoomIn, ZoomOut, Search, Play, Bot, Zap, FileText, Settings
} from 'lucide-react';
import { useBotRunner } from '@/hooks/use-bot-runner';

const MARKETS = ['Derived', 'Forex', 'Commodities', 'Crypto'];
const SUB_MARKETS = ['Continuous Indices', 'Jump Indices', 'Spot Indices'];
const TRADE_TYPES = ['Digits', 'Up/Down', 'Touch/No Touch', 'Higher/Lower'];
const SUB_TYPES = ['Over/Under', 'Matches/Differs', 'Even/Odd', 'Over/Under'];
const CONTRACT_TYPES = ['Both', 'Over', 'Under', 'Matches', 'Differs'];
const CANDLE_INTERVALS = ['1 tick', '5 ticks', '15 ticks', '1 minute', '5 minutes', '15 minutes'];
const DURATIONS = ['Ticks', 'Seconds', 'Minutes', 'Hours'];

const SIDEBAR_ITEMS = [
  { id: 'bot-builder', label: 'Bot Builder', icon: Bot, active: true },
  { id: 'free-bots', label: 'Free Bots', icon: Zap },
  { id: 'strategy-pro', label: 'Strategy Pro', icon: Settings },
  { id: 'speedbot', label: 'Speedbot', icon: RefreshCw },
  { id: 'ai-software', label: 'AI Software', icon: FileText },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
];

const TOOLBAR_ICONS = [
  { icon: Save, label: 'Save' },
  { icon: FolderOpen, label: 'Open' },
  { icon: BarChart3, label: 'Chart' },
  { icon: Undo2, label: 'Undo' },
  { icon: Redo2, label: 'Redo' },
  { icon: RefreshCw, label: 'Refresh' },
  { icon: ZoomIn, label: 'Zoom In' },
  { icon: ZoomOut, label: 'Zoom Out' },
  { icon: Search, label: 'Search' },
];

function PillSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-white text-xs font-medium px-4 py-2 rounded-full flex items-center gap-2 min-w-[140px] justify-between transition-all duration-200"
        style={{ background: '#000000', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <span>{value}</span>
        <span className="text-gray-500">▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-[#161b22] text-white rounded-lg z-50 min-w-[160px] py-1 max-h-48 overflow-y-auto wp-scroll" style={{
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 16px rgba(0,0,0,0.3)',
        }}>
          {options.map((o) => (
            <button
              key={o}
              onClick={() => { onChange(o); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${o === value ? 'font-bold text-[#00d4aa]' : 'text-gray-300 hover:bg-[rgba(255,255,255,0.05)] hover:text-white'}`}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NumberInput({ value, onChange, min = 0, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; step?: number }) {
  return (
    <div className="flex items-center rounded-full overflow-hidden transition-all duration-200" style={{
      background: '#000000',
      border: '1px solid rgba(255,255,255,0.1)',
    }}>
      <button onClick={() => onChange(Math.max(min, value - step))} className="px-3 py-2 text-white hover:bg-[rgba(255,255,255,0.05)] text-xs transition-colors">−</button>
      <input type="number" value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} className="w-16 bg-transparent text-center text-white text-xs outline-none" min={min} step={step} />
      <button onClick={() => onChange(value + step)} className="px-3 py-2 text-white hover:bg-[rgba(255,255,255,0.05)] text-xs transition-colors">+</button>
    </div>
  );
}

export function BotBuilder() {
  const { botConfig, updateBotConfig, isBotRunning, fastSpeed, setFastSpeed, setActiveTab,
    botTradeCount, botSessionProfit, botConsecutiveLosses, totalWins, totalLosses,
  } = useWorldpadStore();
  const { startBot, stopBot } = useBotRunner();
  const [sidebarActive, setSidebarActive] = useState('bot-builder');
  const [errorRestart, setErrorRestart] = useState([false, false]);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const handleRunToggle = useCallback(() => {
    if (isBotRunning) {
      stopBot();
    } else {
      useWorldpadStore.getState().setActiveBotId(null);
      useWorldpadStore.getState().setActiveBotStrategy(null);
      startBot();
    }
  }, [isBotRunning, startBot, stopBot]);

  const totalTrades = totalWins + totalLosses;
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0.0';
  const martMultiplier = botConsecutiveLosses > 0 ? Math.pow(botConfig.martingale, botConsecutiveLosses) : 0;

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex h-[calc(100vh-52px)] overflow-hidden">
      {/* Left Sidebar */}
      <div className="hidden md:flex flex-col w-48 min-w-[192px] py-3 relative overflow-hidden" style={{
        background: 'linear-gradient(180deg, #0a2463 0%, #0d1f4e 100%)',
      }}>
        {SIDEBAR_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => { setSidebarActive(item.id); if (item.id === 'free-bots') setActiveTab('free-bots'); }}
            className={`flex items-center gap-3 px-4 py-2.5 text-xs font-medium transition-all duration-200 relative ${sidebarActive === item.id ? 'text-[#ff6b35]' : 'text-gray-300/70 hover:text-white hover:bg-[rgba(255,255,255,0.04)]'}`}
            style={sidebarActive === item.id ? { background: 'rgba(255,107,53,0.08)', textShadow: '0 0 8px rgba(255,107,53,0.4)' } : {}}
          >
            {sidebarActive === item.id && <div className="absolute right-0 top-1 bottom-1 w-0.5 rounded-full" style={{ background: 'linear-gradient(180deg, #ff6b35, #f59e0b)', boxShadow: '0 0 8px rgba(255,107,53,0.5)' }} />}
            <item.icon className="w-4 h-4" style={sidebarActive === item.id ? { filter: 'drop-shadow(0 0 4px rgba(255,107,53,0.5))' } : {}} />
            {item.label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="hidden md:flex flex-col w-10 py-3 items-center gap-1" style={{ background: 'rgba(0,0,0,0.6)', borderRight: '1px solid rgba(255,255,255,0.04)' }}>
        {TOOLBAR_ICONS.map((t) => (
          <button key={t.label} title={t.label} className="p-2 text-gray-600 hover:text-white transition-all duration-200 hover:bg-[rgba(255,255,255,0.04)] rounded">
            <t.icon className="w-4 h-4" />
          </button>
        ))}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto wp-scroll p-4 flex flex-col gap-4">
        {/* Trade Parameters */}
        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(22,27,34,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="wp-section-header px-4 py-2.5">
            <h3 className="text-xs font-bold text-white tracking-wide uppercase" style={{ letterSpacing: '0.08em' }}>Trade Parameters</h3>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Market</label>
              <PillSelect value={botConfig.market} options={MARKETS} onChange={(v) => updateBotConfig({ market: v })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Sub-Market</label>
              <PillSelect value={botConfig.subMarket} options={SUB_MARKETS} onChange={(v) => updateBotConfig({ subMarket: v })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Trade Type</label>
              <PillSelect value={botConfig.tradeType} options={TRADE_TYPES} onChange={(v) => updateBotConfig({ tradeType: v })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Sub-Type</label>
              <PillSelect value={botConfig.subType} options={SUB_TYPES} onChange={(v) => updateBotConfig({ subType: v })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Contract Type</label>
              <PillSelect value={botConfig.contractType} options={CONTRACT_TYPES} onChange={(v) => updateBotConfig({ contractType: v })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Default Candle Interval</label>
              <PillSelect value={botConfig.candleInterval} options={CANDLE_INTERVALS} onChange={(v) => updateBotConfig({ candleInterval: v })} />
            </div>
            <div className="flex items-center gap-4 col-span-full">
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
                <input type="checkbox" checked={errorRestart[0]} onChange={(e) => setErrorRestart([e.target.checked, errorRestart[1]])} className="rounded accent-[#00d4aa]" />
                Restart on Error
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
                <input type="checkbox" checked={errorRestart[1]} onChange={(e) => setErrorRestart([errorRestart[0], e.target.checked])} className="rounded accent-[#00d4aa]" />
                Restart on Loss
              </label>
            </div>
          </div>
        </div>

        {/* Run once at start */}
        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(22,27,34,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="wp-section-header px-4 py-2.5 flex items-center justify-between">
            <h3 className="text-xs font-bold text-white tracking-wide uppercase" style={{ letterSpacing: '0.08em' }}>Run Once at Start</h3>
            <span className="text-[10px] text-gray-400 font-medium">First trade config</span>
          </div>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Stake</label>
              <NumberInput value={botConfig.stake} onChange={(v) => updateBotConfig({ stake: v })} step={0.1} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Expected Profit</label>
              <NumberInput value={botConfig.expectedProfit} onChange={(v) => updateBotConfig({ expectedProfit: v })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Stop Loss</label>
              <NumberInput value={botConfig.stopLoss} onChange={(v) => updateBotConfig({ stopLoss: v })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Martingale</label>
              <NumberInput value={botConfig.martingale} onChange={(v) => updateBotConfig({ martingale: v })} step={0.5} min={1} />
            </div>
          </div>
        </div>

        {/* Trade Options + Execution Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-xl overflow-hidden" style={{ background: 'rgba(22,27,34,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="wp-section-header px-4 py-2.5">
              <h3 className="text-xs font-bold text-white tracking-wide uppercase" style={{ letterSpacing: '0.08em' }}>Trade Options</h3>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Duration</label>
                <PillSelect value={botConfig.duration} options={DURATIONS} onChange={(v) => updateBotConfig({ duration: v })} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Duration Value</label>
                <NumberInput value={botConfig.durationValue} onChange={(v) => updateBotConfig({ durationValue: v })} min={1} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Stake Currency</label>
                <div className="text-white text-xs font-medium px-4 py-2 rounded-full" style={{ background: '#000000', border: '1px solid rgba(255,255,255,0.1)' }}>USD</div>
              </div>
              <div className="flex flex-col gap-1 sm:col-span-3">
                <label className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Prediction</label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">random integer from</span>
                  <NumberInput value={botConfig.predictionFrom} onChange={(v) => updateBotConfig({ predictionFrom: v })} min={0} max={9} />
                  <span className="text-xs text-gray-400">to</span>
                  <NumberInput value={botConfig.predictionTo} onChange={(v) => updateBotConfig({ predictionTo: v })} min={0} max={9} />
                </div>
              </div>
            </div>
          </div>

          {/* Execution Panel */}
          <div className="rounded-xl p-4 flex flex-col items-center justify-center gap-3" style={{ background: 'rgba(22,27,34,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="grid grid-cols-3 gap-2 w-full">
              <div className="text-center">
                <span className="text-[9px] text-gray-500 block">Trades</span>
                <span className="text-sm font-black font-mono text-white">{botTradeCount}</span>
              </div>
              <div className="text-center">
                <span className="text-[9px] text-gray-500 block">Win Rate</span>
                <span className="text-sm font-black font-mono" style={{ color: parseFloat(winRate) >= 50 ? '#22c55e' : '#ef4444' }}>{winRate}%</span>
              </div>
              <div className="text-center">
                <span className="text-[9px] text-gray-500 block">P/L</span>
                <span className="text-sm font-black font-mono" style={{ color: botSessionProfit >= 0 ? '#22c55e' : '#ef4444' }}>{botSessionProfit >= 0 ? '+' : ''}{botSessionProfit.toFixed(2)}</span>
              </div>
            </div>
            {botConsecutiveLosses > 0 ? (
              <div className="text-[10px] font-mono" style={{ color: '#eab308' }}>
                Martingale: x{martMultiplier.toFixed(2)} ({botConsecutiveLosses} losses)
              </div>
            ) : null}
            <div className="flex flex-col items-center gap-2 w-full">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Execution Speed</span>
              <div className="flex flex-col items-center gap-1">
                <button onClick={() => setFastSpeed(!fastSpeed)} className="relative w-12 h-6 rounded-full transition-all duration-300" style={fastSpeed ? { background: 'linear-gradient(135deg, #00d4aa, #00b8a9)', boxShadow: '0 0 12px rgba(0,212,170,0.4)' } : { background: '#21262d' }}>
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all duration-300 ${fastSpeed ? 'left-7' : 'left-1'}`} />
                </button>
                <span className="text-[10px] text-gray-500">{fastSpeed ? 'FAST' : 'NORMAL'}</span>
              </div>
            </div>
            <button onClick={handleRunToggle} className={`w-full flex items-center justify-center gap-2 px-8 py-3 rounded-xl font-bold text-sm transition-all duration-200 ${isBotRunning ? 'text-white hover:brightness-110' : 'text-[#0d1117] hover:translate-y-[-1px]'}`} style={isBotRunning ? { background: 'linear-gradient(135deg, #dc2626, #ef4444)', boxShadow: '0 0 20px rgba(220,38,38,0.3)' } : { background: 'linear-gradient(135deg, #00d4aa, #00b8a9)', boxShadow: '0 0 20px rgba(0,212,170,0.4), 0 0 40px rgba(0,212,170,0.15)' }}>
              <Play className="w-5 h-5" />
              {isBotRunning ? 'STOP' : 'RUN'}
            </button>
          </div>
        </div>

        {/* Collapsible Sections */}
        {['Purchase Conditions', 'Sell Conditions', 'Restrictions', 'Last Digit Stats'].map((section) => (
          <div key={section} className="rounded-xl overflow-hidden" style={{ background: 'rgba(22,27,34,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <button onClick={() => toggleSection(section)} className="w-full wp-section-header px-4 py-2.5 flex items-center justify-between transition-colors hover:brightness-110">
              <h3 className="text-xs font-bold text-white tracking-wide uppercase" style={{ letterSpacing: '0.08em' }}>{section}</h3>
              <span className="text-gray-400 text-xs">{collapsedSections[section] ? '▸' : '▾'}</span>
            </button>
            {!collapsedSections[section] && <div className="p-4"><p className="text-xs text-gray-500">Configure {section.toLowerCase()} for your bot strategy.</p></div>}
          </div>
        ))}
      </div>
    </div>
  );
}

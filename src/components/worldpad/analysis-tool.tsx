'use client';

import { useWorldpadStore } from '@/lib/store';
import { useState, useMemo } from 'react';
import { Play, Zap, AlertTriangle, Sparkles } from 'lucide-react';

const MARKETS = [
  'Volatility 100 (1s) Index',
  'Volatility 100 Index',
  'Volatility 75 (1s) Index',
  'Volatility 75 Index',
  'Volatility 50 (1s) Index',
  'Volatility 50 Index',
  'Volatility 25 (1s) Index',
  'Volatility 25 Index',
  'Volatility 10 (1s) Index',
  'Volatility 10 Index',
];

const MARKET_SYMBOLS: Record<string, string> = {
  'Volatility 100 (1s) Index': '1HZ100V',
  'Volatility 100 Index': 'R_100',
  'Volatility 75 (1s) Index': '1HZ75V',
  'Volatility 75 Index': 'R_75',
  'Volatility 50 (1s) Index': '1HZ50V',
  'Volatility 50 Index': 'R_50',
  'Volatility 25 (1s) Index': '1HZ25V',
  'Volatility 25 Index': 'R_25',
  'Volatility 10 (1s) Index': '1HZ10V',
  'Volatility 10 Index': 'R_10',
};

function getDigitColor(pct: number, maxPct: number) {
  if (pct >= maxPct * 0.9) return '#22c55e';
  if (pct >= maxPct * 0.7) return '#eab308';
  return '#ef4444';
}

function DigitCircle({ digit, pct, selected, maxPct, onClick }: {
  digit: number; pct: number; selected: boolean; maxPct: number; onClick: () => void;
}) {
  const color = getDigitColor(pct, maxPct);
  const circumference = 2 * Math.PI * 20;
  const fillPct = pct / 20;
  const dashOffset = circumference - fillPct * circumference;

  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-all duration-300 ${selected ? 'scale-110' : 'hover:scale-105'}`}
    >
      <div className={`relative w-12 h-12 sm:w-14 sm:h-14 transition-all duration-300 ${selected ? 'animate-scale-in' : ''}`}>
        {/* SVG arc background */}
        <svg className="w-full h-full -rotate-90" viewBox="0 0 44 44">
          <defs>
            <linearGradient id={`arc-${digit}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={color} stopOpacity="1" />
              <stop offset="100%" stopColor={color} stopOpacity="0.5" />
            </linearGradient>
          </defs>
          {/* Background circle */}
          <circle cx="22" cy="22" r="20" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="2.5" />
          {/* Progress arc */}
          <circle
            cx="22" cy="22" r="20"
            fill="none"
            stroke={`url(#arc-${digit})`}
            strokeWidth="2.5"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
          />
        </svg>
        {/* Center digit */}
        <span
          className="absolute inset-0 flex items-center justify-center text-sm font-bold transition-all"
          style={{ color, textShadow: selected ? `0 0 8px ${color}60` : 'none' }}
        >
          {digit}
        </span>
        {/* Selected glow ring */}
        {selected && (
          <div className="absolute inset-0 rounded-full" style={{
            boxShadow: `0 0 12px ${color}40, inset 0 0 12px ${color}15`,
          }} />
        )}
      </div>
      <span className="text-[10px] font-mono font-medium" style={{ color }}>{pct.toFixed(1)}%</span>
    </button>
  );
}

function ProgressBar({ label, value, color, max = 100 }: {
  label: string; value: number; color: string; max?: number;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex-1">
      <div className="flex justify-between text-[10px] mb-1.5">
        <span className="font-bold" style={{ color, textShadow: `0 0 6px ${color}40` }}>{label}</span>
        <span className="font-mono" style={{ color }}>{value.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden relative" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div
          className="h-full rounded-full animate-progress-fill relative"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}cc, ${color})`,
            boxShadow: `0 0 8px ${color}40`,
          }}
        />
        {/* Glow at tip */}
        {pct > 5 && (
          <div
            className="absolute top-0 h-full w-2 rounded-full"
            style={{
              left: `calc(${pct}% - 4px)`,
              background: color,
              filter: 'blur(4px)',
              opacity: 0.6,
            }}
          />
        )}
      </div>
    </div>
  );
}

function HistoryStrip({ history, typeMap }: { history: string[]; typeMap: Record<string, { color: string; label: string }> }) {
  return (
    <div className="flex gap-1 flex-wrap max-h-16 overflow-y-auto wp-scroll">
      {history.slice(-50).map((entry, i) => {
        const cfg = typeMap[entry] || { color: '#666', label: entry };
        return (
          <div
            key={i}
            className="w-6 h-6 rounded flex items-center justify-center text-[9px] font-bold transition-all hover:scale-110"
            style={{
              background: `${cfg.color}22`,
              color: cfg.color,
              border: `1px solid ${cfg.color}33`,
            }}
            title={cfg.label}
          >
            {entry}
          </div>
        );
      })}
      {history.length === 0 && <span className="text-[10px] text-gray-600 animate-pulse">Waiting for data...</span>}
    </div>
  );
}

function AnalysisPanel({ title, subtitle, digits, selectedDigit, onSelectDigit, overLabel, underLabel, overPct, underPct, overColor, underColor, history, historyMap, onMore }: {
  title: string; subtitle: string; digits: number[]; selectedDigit: number; onSelectDigit: (d: number) => void;
  overLabel: string; underLabel: string; overPct: number; underPct: number;
  overColor: string; underColor: string; history: string[]; historyMap: Record<string, { color: string; label: string }>;
  onMore?: () => void;
}) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-3 transition-all duration-200 hover:border-[rgba(255,255,255,0.1)]" style={{
      background: 'rgba(22, 27, 34, 0.8)',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold text-white uppercase tracking-wide" style={{ letterSpacing: '0.08em' }}>{title}</h3>
          <p className="text-[10px] text-gray-500 mt-0.5">{subtitle}</p>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {digits.map((d, i) => (
          <button
            key={d}
            onClick={() => onSelectDigit(d)}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border transition-all duration-200 ${
              selectedDigit === d ? 'scale-110' : 'hover:scale-105'
            }`}
            style={{
              background: selectedDigit === d ? `${overColor}22` : 'rgba(255,255,255,0.03)',
              borderColor: selectedDigit === d ? `${overColor}66` : 'rgba(255,255,255,0.08)',
              color: selectedDigit === d ? overColor : 'rgba(255,255,255,0.4)',
              ...(selectedDigit === d ? { boxShadow: `0 0 12px ${overColor}30` } : {}),
            }}
          >
            {i}
          </button>
        ))}
      </div>
      <div className="flex gap-3">
        <ProgressBar label={overLabel} value={overPct} color={overColor} />
        <ProgressBar label={underLabel} value={underPct} color={underColor} />
      </div>
      <HistoryStrip history={history} typeMap={historyMap} />
      {onMore && (
        <button onClick={onMore} className="text-[10px] text-gray-500 hover:text-[#00d4aa] transition-colors self-end">+ More</button>
      )}
    </div>
  );
}

export function AnalysisTool() {
  const {
    activeMarket, setActiveMarket, ticks, setTicks, livePrice,
    digitDistribution, overUnderHistory, matchDifferHistory,
    evenOddHistory, riseFallHistory, selectedAnalysisDigit,
    analysisOverUnderDigit, analysisMatchDifferDigit,
    setSelectedAnalysisDigit, setAnalysisOverUnderDigit, setAnalysisMatchDifferDigit,
    isBotRunning, setIsBotRunning, fastSpeed, setFastSpeed,
  } = useWorldpadStore();

  const [subTab, setSubTab] = useState<'circles' | 'scanner'>('circles');
  const [marketOpen, setMarketOpen] = useState(false);

  const activeMarketLabel = useMemo(() => {
    const entry = Object.entries(MARKET_SYMBOLS).find(([, v]) => v === activeMarket);
    return entry ? entry[0] : 'Volatility 100 (1s) Index';
  }, [activeMarket]);

  const maxDigit = Math.max(...digitDistribution);

  const overUnderDigit = analysisOverUnderDigit;
  const ouOver = overUnderHistory.filter(h => h === 'O').length;
  const ouUnder = overUnderHistory.filter(h => h === 'U').length;
  const ouTotal = ouOver + ouUnder || 1;
  const ouOverPct = (ouOver / ouTotal) * 100;
  const ouUnderPct = (ouUnder / ouTotal) * 100;

  const mdDigit = analysisMatchDifferDigit;
  const mdMatch = matchDifferHistory.filter(h => h === 'M').length;
  const mdDiffer = matchDifferHistory.filter(h => h === 'D').length;
  const mdTotal = mdMatch + mdDiffer || 1;
  const mdMatchPct = (mdMatch / mdTotal) * 100;
  const mdDifferPct = (mdDiffer / mdTotal) * 100;

  const eoEven = evenOddHistory.filter(h => h === 'E').length;
  const eoOdd = evenOddHistory.filter(h => h === 'O').length;
  const eoTotal = eoEven + eoOdd || 1;
  const eoEvenPct = (eoEven / eoTotal) * 100;
  const eoOddPct = (eoOdd / eoTotal) * 100;

  const rfRise = riseFallHistory.filter(h => h === 'R').length;
  const rfFall = riseFallHistory.filter(h => h === 'F').length;
  const rfTotal = rfRise + rfFall || 1;
  const rfRisePct = (rfRise / rfTotal) * 100;
  const rfFallPct = (rfFall / rfTotal) * 100;

  return (
    <div className="h-[calc(100vh-52px)] flex flex-col overflow-hidden">
      {/* Sub-navigation */}
      <div className="flex items-center gap-1 px-4 py-2" style={{
        background: 'rgba(22, 27, 34, 0.8)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <button
          onClick={() => setSubTab('circles')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
            subTab === 'circles'
              ? 'text-[#ff6b35]'
              : 'text-gray-500 hover:text-white hover:bg-[rgba(255,255,255,0.03)]'
          }`}
          style={subTab === 'circles' ? {
            background: 'rgba(255,107,53,0.1)',
            border: '1px solid rgba(255,107,53,0.2)',
            textShadow: '0 0 8px rgba(255,107,53,0.5)',
          } : {
            border: '1px solid transparent',
          }}
        >
          Circles
        </button>
        <button
          onClick={() => setSubTab('scanner')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
            subTab === 'scanner'
              ? 'text-[#7c8aff]'
              : 'text-gray-500 hover:text-white hover:bg-[rgba(255,255,255,0.03)]'
          }`}
          style={subTab === 'scanner' ? {
            background: 'rgba(124,138,255,0.1)',
            border: '1px solid rgba(124,138,255,0.2)',
            textShadow: '0 0 8px rgba(124,138,255,0.5)',
          } : {
            border: '1px solid transparent',
          }}
        >
          Scanner
        </button>
      </div>

      {/* Config Row */}
      <div className="flex items-center gap-3 px-4 py-2 border-b flex-wrap" style={{
        background: 'rgba(13, 17, 23, 0.6)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        <div className="relative">
          <button
            onClick={() => setMarketOpen(!marketOpen)}
            className="text-white text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-2 transition-all duration-200 hover:border-[rgba(255,255,255,0.2)]"
            style={{
              background: '#000000',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <span>{activeMarketLabel}</span>
            <span className="text-gray-500">▾</span>
          </button>
          {marketOpen && (
            <div className="absolute top-full left-0 mt-1 bg-[#161b22] text-white rounded-lg z-50 min-w-[220px] py-1 max-h-60 overflow-y-auto wp-scroll" style={{
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 16px rgba(0,0,0,0.3)',
            }}>
              {MARKETS.map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setActiveMarket(MARKET_SYMBOLS[m]);
                    setMarketOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${m === activeMarketLabel ? 'font-bold text-[#00d4aa]' : 'text-gray-300 hover:bg-[rgba(255,255,255,0.05)]'}`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Ticks:</span>
          <input
            type="number"
            value={ticks}
            onChange={(e) => setTicks(parseInt(e.target.value) || 100)}
            className="w-16 text-white text-xs px-2 py-1.5 rounded-full text-center outline-none transition-all duration-200 focus:border-[rgba(0,212,170,0.4)]"
            style={{
              background: '#000000',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          />
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">LIVE PRICE</span>
          <span className="text-sm font-mono font-bold" style={{
            color: '#00d4aa',
            textShadow: '0 0 10px rgba(0,212,170,0.6)',
          }}>
            {livePrice > 0 ? livePrice.toFixed(4) : '---'}
          </span>
        </div>
      </div>

      {/* Panels Grid */}
      <div className="flex-1 overflow-y-auto wp-scroll p-4 flex flex-col gap-4">
        {/* Panel A: Digit Circles (full width) */}
        <div className="rounded-xl p-4" style={{
          background: 'rgba(22, 27, 34, 0.8)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <h3 className="text-xs font-bold text-white uppercase tracking-wide mb-3" style={{ letterSpacing: '0.08em' }}>Digit Distribution</h3>
          <div className="flex items-end justify-center gap-2 sm:gap-4 flex-wrap">
            {[0,1,2,3,4,5,6,7,8,9].map((d) => (
              <DigitCircle
                key={d}
                digit={d}
                pct={digitDistribution[d]}
                selected={selectedAnalysisDigit === d}
                maxPct={maxDigit}
                onClick={() => setSelectedAnalysisDigit(d)}
              />
            ))}
          </div>
        </div>

        {/* Panel B & C: Over/Under and Match/Differ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AnalysisPanel
            title="OVER / UNDER"
            subtitle={`${overUnderDigit}x Under`}
            digits={[0,1,2,3,4,5,6,7,8,9]}
            selectedDigit={overUnderDigit}
            onSelectDigit={setAnalysisOverUnderDigit}
            overLabel="OVER"
            underLabel="UNDER"
            overPct={ouOverPct}
            underPct={ouUnderPct}
            overColor="#22c55e"
            underColor="#ff6b35"
            history={overUnderHistory}
            historyMap={{
              O: { color: '#22c55e', label: 'Over' },
              U: { color: '#ff6b35', label: 'Under' },
            }}
          />
          <AnalysisPanel
            title="MATCH / DIFFER"
            subtitle={`Digit ${mdDigit}`}
            digits={[0,1,2,3,4,5,6,7,8,9]}
            selectedDigit={mdDigit}
            onSelectDigit={setAnalysisMatchDifferDigit}
            overLabel="MATCH"
            underLabel="DIFFER"
            overPct={mdMatchPct}
            underPct={mdDifferPct}
            overColor="#ef4444"
            underColor="#8b5cf6"
            history={matchDifferHistory}
            historyMap={{
              M: { color: '#ef4444', label: 'Match' },
              D: { color: '#8b5cf6', label: 'Differ' },
            }}
          />
        </div>

        {/* Panel D & E: Even/Odd and Rise/Fall */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl p-4 flex flex-col gap-3" style={{
            background: 'rgba(22, 27, 34, 0.8)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wide" style={{ letterSpacing: '0.08em' }}>EVEN / ODD</h3>
              <p className="text-[10px] text-gray-500 mt-0.5">Parity analysis</p>
            </div>
            <div className="flex gap-3">
              <ProgressBar label="EVEN" value={eoEvenPct} color="#ff6b35" />
              <ProgressBar label="ODD" value={eoOddPct} color="#ef4444" />
            </div>
            <HistoryStrip
              history={evenOddHistory}
              typeMap={{
                E: { color: '#ff6b35', label: 'Even' },
                O: { color: '#ef4444', label: 'Odd' },
              }}
            />
          </div>
          <div className="rounded-xl p-4 flex flex-col gap-3" style={{
            background: 'rgba(22, 27, 34, 0.8)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wide" style={{ letterSpacing: '0.08em' }}>RISE / FALL</h3>
              <p className="text-[10px] text-gray-500 mt-0.5">Direction analysis</p>
            </div>
            <div className="flex gap-3">
              <ProgressBar label="RISE" value={rfRisePct} color="#22c55e" />
              <ProgressBar label="FALL" value={rfFallPct} color="#ef4444" />
            </div>
            <HistoryStrip
              history={riseFallHistory}
              typeMap={{
                R: { color: '#22c55e', label: 'Rise' },
                F: { color: '#ef4444', label: 'Fall' },
              }}
            />
          </div>
        </div>

        {/* Bottom Action Bar */}
        <div className="flex items-center justify-between flex-wrap gap-3 pb-4">
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200" style={{
              background: 'rgba(234, 179, 8, 0.1)',
              color: '#eab308',
              border: '1px solid rgba(234, 179, 8, 0.2)',
            }}>
              <AlertTriangle className="w-3.5 h-3.5" />
              Error
            </button>
            <button
              onClick={() => setIsBotRunning(!isBotRunning)}
              className={`flex items-center gap-1.5 px-6 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
                isBotRunning ? 'text-white hover:brightness-110' : 'text-[#0d1117]'
              }`}
              style={isBotRunning ? {
                background: 'linear-gradient(135deg, #dc2626, #ef4444)',
                boxShadow: '0 0 16px rgba(220, 38, 38, 0.3)',
              } : {
                background: 'linear-gradient(135deg, #00d4aa, #00b8a9)',
                boxShadow: '0 0 16px rgba(0, 212, 170, 0.35), 0 0 32px rgba(0, 212, 170, 0.1)',
              }}
            >
              <Play className="w-3.5 h-3.5" />
              {isBotRunning ? 'STOP' : 'RUN'}
            </button>
            <button
              onClick={() => setFastSpeed(!fastSpeed)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold transition-all duration-200 ${
                fastSpeed ? '' : ''
              }`}
              style={fastSpeed ? {
                background: 'rgba(255,107,53,0.15)',
                color: '#ff6b35',
                border: '1px solid rgba(255,107,53,0.3)',
                textShadow: '0 0 6px rgba(255,107,53,0.5)',
              } : {
                background: '#000000',
                color: '#7d8590',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <Zap className="w-3 h-3" />
              FAST
            </button>
          </div>
        </div>
      </div>

      {/* Floating AI Button with glow */}
      <button
        className="fixed bottom-6 right-6 w-12 h-12 rounded-full flex items-center justify-center z-40 transition-all duration-300 hover:scale-110 hover:translate-y-[-2px]"
        style={{
          background: 'linear-gradient(135deg, #8b5cf6, #d946ef)',
          boxShadow: '0 0 20px rgba(139, 92, 246, 0.4), 0 0 40px rgba(139, 92, 246, 0.15)',
        }}
      >
        <Sparkles className="w-5 h-5 text-white" />
      </button>
    </div>
  );
}

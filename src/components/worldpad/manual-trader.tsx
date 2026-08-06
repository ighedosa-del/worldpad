'use client';

import { useWorldpadStore } from '@/lib/store';
import { useTradeExecution } from '@/hooks/use-trade-execution';
import { useState, useMemo, useCallback, useRef } from 'react';
import { Zap, Play, Loader2, CheckCircle2, XCircle } from 'lucide-react';

const MARKETS = [
  { label: 'Volatility 100 (1s)', symbol: '1HZ100V' },
  { label: 'Volatility 75 (1s)', symbol: '1HZ75V' },
  { label: 'Volatility 50 (1s)', symbol: '1HZ50V' },
  { label: 'Volatility 25 (1s)', symbol: '1HZ25V' },
  { label: 'Volatility 10 (1s)', symbol: '1HZ10V' },
  { label: 'Volatility 100', symbol: 'R_100' },
  { label: 'Volatility 75', symbol: 'R_75' },
  { label: 'Volatility 50', symbol: 'R_50' },
  { label: 'Volatility 25', symbol: 'R_25' },
  { label: 'Volatility 10', symbol: 'R_10' },
];

function DigitArc({ digit, pct, onClick, flashResult }: { digit: number; pct: number; onClick: (d: number) => void; flashResult: 'win' | 'loss' | null }) {
  const color = pct >= 12 ? '#22c55e' : pct >= 9 ? '#eab308' : '#ef4444';
  const circumference = 2 * Math.PI * 18;
  const dashOffset = circumference - (pct / 20) * circumference;
  const isHot = pct >= 12;
  return (
    <div className="flex flex-col items-center gap-1 group cursor-pointer" onClick={() => onClick(digit)}>
      <div className={`relative w-12 h-12 sm:w-14 sm:h-14 transition-all duration-300 ${isHot ? 'animate-scale-in' : ''}`}>
        <svg className="w-full h-full -rotate-90" viewBox="0 0 40 40">
          <defs>
            <linearGradient id={`m-arc-${digit}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color} stopOpacity="0.4" />
            </linearGradient>
          </defs>
          {/* Background ring */}
          <circle cx="20" cy="20" r="18" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="2.5" />
          {/* Animated progress arc */}
          <circle
            cx="20" cy="20" r="18"
            fill="none"
            stroke={`url(#m-arc-${digit})`}
            strokeWidth="2.5"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
          />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center text-xs font-bold transition-all duration-300 group-hover:scale-110"
          style={{ color, textShadow: isHot ? `0 0 8px ${color}60` : 'none' }}
        >
          {digit}
        </span>
        {/* Trade result flash overlay */}
        {flashResult && (
          <div className="absolute inset-0 rounded-full flex items-center justify-center" style={{
            background: flashResult === 'win' ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)',
            boxShadow: flashResult === 'win' ? '0 0 20px rgba(34,197,94,0.4)' : '0 0 20px rgba(239,68,68,0.4)',
            animation: 'fadeInOut 0.6s ease-out forwards',
          }}>
            {flashResult === 'win' ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
          </div>
        )}
        {/* Glow for hot digits */}
        {isHot && (
          <div className="absolute inset-0 rounded-full" style={{
            boxShadow: `0 0 16px ${color}30, inset 0 0 8px ${color}10`,
          }} />
        )}
      </div>
      <span className="text-[10px] font-mono font-medium" style={{ color }}>{pct.toFixed(1)}%</span>
    </div>
  );
}

export function ManualTrader() {
  const {
    activeMarket, setActiveMarket, livePrice, currentDigit,
    digitDistribution, isBotRunning, setIsBotRunning,
    fastSpeed, setFastSpeed, digitHistory, matchDifferHistory,
    tradeHistory, totalWins, totalLosses, totalProfit, isPlacingTrade,
  } = useWorldpadStore();
  const { quickTrade } = useTradeExecution();

  const [tradeType, setTradeType] = useState<'differs' | 'matches'>('differs');
  const [flashDigit, setFlashDigit] = useState<{ digit: number; result: 'win' | 'loss' } | null>(null);
  const [prediction, setPrediction] = useState(5);
  const [tradeTicks, setTradeTicks] = useState(1);
  const [stake, setStake] = useState(0.5);
  const [numTrades, setNumTrades] = useState(5);
  const [botStatus, setBotStatus] = useState('Bot is not running');
  const [marketOpen, setMarketOpen] = useState(false);
  const [lastResult, setLastResult] = useState<{won: boolean; profit: number} | null>(null);
  const botInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const marketLabel = useMemo(() => {
    const m = MARKETS.find(m => m.symbol === activeMarket);
    return m ? m.label : activeMarket;
  }, [activeMarket]);

  const recentDigits = digitHistory.slice(-100);
  const differsCount = recentDigits.filter(d => d !== prediction).length;
  const matchesCount = recentDigits.filter(d => d === prediction).length;
  const totalRecent = recentDigits.length || 1;
  const differsPct = (differsCount / totalRecent) * 100;
  const matchesPct = (matchesCount / totalRecent) * 100;

  const handleDigitClick = useCallback(async (digit: number) => {
    if (isPlacingTrade || isBotRunning) return;
    const r = await quickTrade(tradeType === 'matches' ? 'match' : 'differ', digit, stake);
    if (r) {
      setFlashDigit({ digit, result: r.won ? 'win' : 'loss' });
      setTimeout(() => setFlashDigit(null), 600);
    }
  }, [tradeType, stake, quickTrade, isPlacingTrade, isBotRunning]);

  const handleRun = useCallback(() => {
    if (!isBotRunning) {
      setIsBotRunning(true);
      setBotStatus('Running...');
      setLastResult(null);
      const curType = tradeType; const pred = prediction; const stk = stake; const max = numTrades;
      let count = 0;
      const exec = async () => {
        if (count >= max) {
          setIsBotRunning(false);
          setBotStatus(`Done - ${count} trades`);
          if (botInterval.current) { clearInterval(botInterval.current); botInterval.current = null; }
          return;
        }
        const r = await quickTrade(curType === 'matches' ? 'match' : 'differ', pred, stk);
        count++;
        if (r) {
          setLastResult({ won: r.won, profit: r.profit });
          setBotStatus(r.won ? `Won +$${r.profit.toFixed(2)}` : `Lost -$${Math.abs(r.profit).toFixed(2)}`);
        } else { setBotStatus('Trade failed'); }
      };
      exec();
      if (max > 1) { botInterval.current = setInterval(exec, fastSpeed ? 2000 : 5000); }
    } else {
      setIsBotRunning(false); setBotStatus('Bot is not running'); setLastResult(null);
      if (botInterval.current) { clearInterval(botInterval.current); botInterval.current = null; }
    }
  }, [isBotRunning, tradeType, prediction, stake, numTrades, fastSpeed, setIsBotRunning, quickTrade]);

  return (
    <div className="h-[calc(100vh-52px)] flex flex-col overflow-hidden">
      {/* Config Bar */}
      <div className="flex items-center gap-3 px-4 py-2 flex-wrap" style={{
        background: 'rgba(22, 27, 34, 0.8)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
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
            <span>{marketLabel}</span>
            <span className="text-gray-500">▾</span>
          </button>
          {marketOpen && (
            <div className="absolute top-full left-0 mt-1 bg-[#161b22] text-white rounded-lg z-50 min-w-[180px] py-1 max-h-60 overflow-y-auto wp-scroll" style={{
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}>
              {MARKETS.map((m) => (
                <button
                  key={m.symbol}
                  onClick={() => { setActiveMarket(m.symbol); setMarketOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${m.symbol === activeMarket ? 'font-bold text-[#00d4aa]' : 'text-gray-300 hover:bg-[rgba(255,255,255,0.05)]'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center rounded-full overflow-hidden" style={{
          background: '#000000',
          border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <button
            onClick={() => setTradeType('differs')}
            className={`px-3 py-1.5 text-xs font-bold transition-all duration-200 ${tradeType === 'differs' ? '' : 'text-white'}`}
            style={tradeType === 'differs' ? {
              background: 'linear-gradient(135deg, #00d4aa, #00b8a9)',
              color: '#0d1117',
            } : {}}
          >
            Differs
          </button>
          <button
            onClick={() => setTradeType('matches')}
            className={`px-3 py-1.5 text-xs font-bold transition-all duration-200 ${tradeType === 'matches' ? '' : 'text-white'}`}
            style={tradeType === 'matches' ? {
              background: 'linear-gradient(135deg, #dc2626, #ef4444)',
              color: 'white',
            } : {}}
          >
            Matches
          </button>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Pred:</span>
          <select
            value={prediction}
            onChange={(e) => setPrediction(parseInt(e.target.value))}
            className="text-white text-xs px-2 py-1.5 rounded-full outline-none transition-all duration-200 focus:border-[rgba(0,212,170,0.4)]"
            style={{
              background: '#000000',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            {[0,1,2,3,4,5,6,7,8,9].map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto wp-scroll p-4 flex flex-col gap-4">
        {/* Current Tick — Large glowing display */}
        <div className="text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 font-medium">Current Tick</p>
          <p className="text-3xl font-mono font-bold" style={{
            color: '#ef4444',
            textShadow: '0 0 20px rgba(239, 68, 68, 0.4), 0 0 40px rgba(239, 68, 68, 0.15)',
          }}>
            {livePrice > 0 ? livePrice.toFixed(4) : '---.----'}
          </p>
          <p className="text-xs text-gray-500 mt-1">Last digit: <span className="text-white font-bold" style={{ textShadow: '0 0 8px rgba(255,255,255,0.3)' }}>{livePrice > 0 ? currentDigit : '-'}</span></p>
        </div>

        {/* Digit Probability Grid with SVG arcs */}
        <div className="rounded-xl p-4" style={{
          background: 'rgba(22, 27, 34, 0.8)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <h3 className="text-xs font-bold text-white uppercase tracking-wide mb-3" style={{ letterSpacing: '0.08em' }}>Digit Probability Grid</h3>
          <div className="grid grid-cols-5 sm:grid-cols-10 gap-3 justify-items-center">
            {[0,1,2,3,4,5,6,7,8,9].map(d => (
              <DigitArc key={d} digit={d} pct={digitDistribution[d]} onClick={handleDigitClick} flashResult={flashDigit?.digit === d ? flashDigit.result : null} />
            ))}
          </div>
        </div>

        {/* Pattern Row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Pattern:</span>
          {matchDifferHistory.slice(-20).reverse().map((entry, i) => (
            <div
              key={i}
              className="w-7 h-7 rounded flex items-center justify-center text-[10px] font-bold transition-all duration-200 hover:scale-110"
              style={entry === 'D' ? {
                background: 'rgba(0, 212, 170, 0.12)',
                color: '#00d4aa',
                border: '1px solid rgba(0, 212, 170, 0.2)',
                boxShadow: '0 0 6px rgba(0, 212, 170, 0.1)',
              } : {
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.2)',
              }}
            >
              {entry}
            </div>
          ))}
        </div>

        {/* Trade Params + Results — Glowing result boxes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Trade Parameters */}
          <div className="rounded-xl p-4" style={{
            background: 'rgba(22, 27, 34, 0.8)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <h3 className="text-xs font-bold text-white uppercase tracking-wide mb-3" style={{ letterSpacing: '0.08em' }}>Trade Parameters</h3>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Ticks</span>
                <input
                  type="number" value={tradeTicks} onChange={(e) => setTradeTicks(parseInt(e.target.value) || 1)}
                  className="w-16 text-white text-xs px-2 py-1 rounded-lg text-center outline-none transition-all duration-200 focus:border-[rgba(0,212,170,0.4)]"
                  style={{
                    background: '#000000',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Stake ($)</span>
                <input
                  type="number" value={stake} onChange={(e) => setStake(parseFloat(e.target.value) || 0)} step={0.1}
                  className="w-16 text-white text-xs px-2 py-1 rounded-lg text-center outline-none transition-all duration-200 focus:border-[rgba(0,212,170,0.4)]"
                  style={{
                    background: '#000000',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">No of Trades</span>
                <input
                  type="number" value={numTrades} onChange={(e) => setNumTrades(parseInt(e.target.value) || 1)}
                  className="w-16 text-white text-xs px-2 py-1 rounded-lg text-center outline-none transition-all duration-200 focus:border-[rgba(0,212,170,0.4)]"
                  style={{
                    background: '#000000',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Glowing Result Boxes */}
          <div className="flex flex-col gap-3">
            <div className="rounded-xl p-4 flex-1 flex flex-col items-center justify-center relative overflow-hidden" style={{
              background: 'rgba(0, 212, 170, 0.04)',
              border: '1px solid rgba(0, 212, 170, 0.15)',
              boxShadow: '0 0 20px rgba(0, 212, 170, 0.06)',
            }}>
              {/* Background glow */}
              <div className="absolute inset-0 opacity-30" style={{
                background: 'radial-gradient(ellipse at center, rgba(0,212,170,0.1), transparent 70%)',
              }} />
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium relative">Differs %</span>
              <span className="text-2xl font-mono font-bold mt-1 relative" style={{
                color: '#00d4aa',
                textShadow: '0 0 16px rgba(0,212,170,0.6), 0 0 32px rgba(0,212,170,0.2)',
              }}>{differsPct.toFixed(1)}%</span>
            </div>
            <div className="rounded-xl p-4 flex-1 flex flex-col items-center justify-center relative overflow-hidden" style={{
              background: 'rgba(239, 68, 68, 0.04)',
              border: '1px solid rgba(239, 68, 68, 0.15)',
              boxShadow: '0 0 20px rgba(239, 68, 68, 0.06)',
            }}>
              <div className="absolute inset-0 opacity-30" style={{
                background: 'radial-gradient(ellipse at center, rgba(239,68,68,0.1), transparent 70%)',
              }} />
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium relative">Matches %</span>
              <span className="text-2xl font-mono font-bold mt-1 relative" style={{
                color: '#ef4444',
                textShadow: '0 0 16px rgba(239,68,68,0.6), 0 0 32px rgba(239,68,68,0.2)',
              }}>{matchesPct.toFixed(1)}%</span>
            </div>
          </div>
        </div>

        {/* Bot Status & Controls */}
        <div className="flex items-center justify-between flex-wrap gap-3 pb-4">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold transition-all duration-200 ${
              botStatus === 'Won ✓' ? 'text-green-400' :
              botStatus === 'Running...' ? 'text-yellow-400' : 'text-gray-500'
            }`} style={
              botStatus === 'Won ✓' ? { textShadow: '0 0 8px rgba(34,197,94,0.6)' } :
              botStatus === 'Running...' ? { textShadow: '0 0 8px rgba(234,179,8,0.6)' } : {}
            }>
              {botStatus}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFastSpeed(!fastSpeed)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold transition-all duration-200`}
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
              FAST SPEED
            </button>
            <button
              onClick={handleRun}
              className={`flex items-center gap-1.5 px-6 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
                isBotRunning ? 'text-white hover:brightness-110' : 'text-[#0d1117]'
              }`}
              style={isBotRunning ? {
                background: 'linear-gradient(135deg, #dc2626, #ef4444)',
                boxShadow: '0 0 16px rgba(220,38,38,0.3)',
              } : {
                background: 'linear-gradient(135deg, #00d4aa, #00b8a9)',
                boxShadow: '0 0 16px rgba(0,212,170,0.35), 0 0 32px rgba(0,212,170,0.1)',
              }}
            >
              <Play className="w-3.5 h-3.5" />
              {isBotRunning ? 'STOP' : 'RUN'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

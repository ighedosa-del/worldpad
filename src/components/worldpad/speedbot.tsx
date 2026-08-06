'use client';

import { useWorldpadStore } from '@/lib/store';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Gauge, Zap, Trophy, Target, TrendingUp, AlertTriangle } from 'lucide-react';

const SPEED_OPTIONS = [1, 5, 10, 20];

export function Speedbot() {
  const { currentDigit, digitDistribution, tradeHistory, isAuthorized, isPlacingTrade } = useWorldpadStore();
  const [prediction, setPrediction] = useState<number | null>(null);
  const [speed, setSpeed] = useState(5);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionTrades, setSessionTrades] = useState(0);
  const [sessionWins, setSessionWins] = useState(0);
  const [sessionLosses, setSessionLosses] = useState(0);
  const [sessionProfit, setSessionProfit] = useState(0);
  const [lastResult, setLastResult] = useState<'win' | 'loss' | null>(null);
  const [flashColor, setFlashColor] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const distMax = Math.max(...digitDistribution, 1);

  const handleTrade = useCallback(() => {
    if (prediction === null) return;
    // Simulate trade result based on current digit
    const won = currentDigit === prediction;
    setSessionTrades(prev => prev + 1);
    if (won) {
      setSessionWins(prev => prev + 1);
      setSessionProfit(prev => prev + 8.5);
      setLastResult('win');
      setFlashColor('#22c55e');
    } else {
      setSessionLosses(prev => prev + 1);
      setSessionProfit(prev => prev - 1);
      setLastResult('loss');
      setFlashColor('#ef4444');
    }
    setTimeout(() => setFlashColor(null), 300);
  }, [prediction, currentDigit]);

  const toggleRunning = useCallback(() => {
    if (isRunning) {
      setIsRunning(false);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    } else {
      if (prediction === null) return;
      setIsRunning(true);
      handleTrade();
      const interval = Math.max(1000 / speed, 50);
      timerRef.current = setInterval(handleTrade, interval);
    }
  }, [isRunning, prediction, speed, handleTrade]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const winRate = sessionTrades > 0 ? ((sessionWins / sessionTrades) * 100).toFixed(1) : '0.0';

  return (
    <div className="h-[calc(100vh-52px)] flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto wp-scroll p-4 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Gauge className="w-5 h-5" style={{ color: '#e040fb' }} />
          <h2 className="text-xs font-bold text-white uppercase tracking-wide" style={{ letterSpacing: '0.08em' }}>
            SPEEDBOT
          </h2>
          <div className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all duration-300 ${isRunning ? 'animate-pulse' : ''}`} style={{
            background: isRunning ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${isRunning ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.06)'}`,
          }}>
            <div className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-green-500' : 'bg-gray-600'}`} style={isRunning ? { boxShadow: '0 0 6px rgba(34,197,94,0.6)' } : {}} />
            <span className="text-[10px] font-bold" style={{ color: isRunning ? '#22c55e' : '#7d8590' }}>{isRunning ? 'LIVE' : 'IDLE'}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1">
          {/* Left: Main trading area */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            {/* Huge Digit Display */}
            <div className="rounded-xl p-6 flex flex-col items-center justify-center relative overflow-hidden" style={{
              background: 'rgba(22, 27, 34, 0.8)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              {/* Flash overlay */}
              {flashColor && (
                <div className="absolute inset-0 pointer-events-none" style={{
                  background: `radial-gradient(circle, ${flashColor}15, transparent 70%)`,
                }} />
              )}
              <span className="text-[10px] text-gray-500 font-bold uppercase mb-2" style={{ letterSpacing: '0.12em' }}>Current Digit</span>
              <span
                className="text-8xl sm:text-9xl font-black font-mono transition-all duration-200"
                style={{
                  color: '#00d4aa',
                  textShadow: '0 0 30px rgba(0,212,170,0.4), 0 0 60px rgba(0,212,170,0.15)',
                }}
              >
                {currentDigit}
              </span>
              {lastResult && (
                <span className="mt-2 text-xs font-bold" style={{
                  color: lastResult === 'win' ? '#22c55e' : '#ef4444',
                  textShadow: `0 0 8px ${lastResult === 'win' ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)'}`,
                }}>
                  {lastResult === 'win' ? '✓ MATCH!' : '✗ MISS'}
                </span>
              )}
            </div>

            {/* Prediction Selector */}
            <div className="rounded-xl p-4" style={{
              background: 'rgba(22, 27, 34, 0.8)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <span className="text-[10px] text-gray-500 font-bold uppercase block mb-3" style={{ letterSpacing: '0.08em' }}>PREDICTION</span>
              <div className="grid grid-cols-10 gap-1.5">
                {[0,1,2,3,4,5,6,7,8,9].map(d => (
                  <button
                    key={d}
                    onClick={() => { if (!isRunning) setPrediction(d); }}
                    className="aspect-square rounded-lg flex items-center justify-center text-lg font-black font-mono transition-all duration-200"
                    style={prediction === d ? {
                      background: 'rgba(0,212,170,0.2)',
                      color: '#00d4aa',
                      border: '1.5px solid rgba(0,212,170,0.5)',
                      boxShadow: '0 0 12px rgba(0,212,170,0.2)',
                      textShadow: '0 0 8px rgba(0,212,170,0.5)',
                    } : d === currentDigit ? {
                      background: 'rgba(0,212,170,0.06)',
                      color: 'rgba(0,212,170,0.6)',
                      border: '1px solid rgba(0,212,170,0.15)',
                    } : {
                      background: 'rgba(255,255,255,0.03)',
                      color: 'rgba(255,255,255,0.3)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Speed Settings + Trade Button */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="rounded-xl p-4 flex-1" style={{
                background: 'rgba(22, 27, 34, 0.8)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}>
                <span className="text-[10px] text-gray-500 font-bold uppercase block mb-2" style={{ letterSpacing: '0.08em' }}>SPEED</span>
                <div className="flex gap-1.5">
                  {SPEED_OPTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => { if (!isRunning) setSpeed(s); }}
                      className="flex-1 py-2 rounded-lg text-xs font-bold transition-all duration-200"
                      style={speed === s ? {
                        background: 'rgba(224,64,251,0.15)',
                        color: '#e040fb',
                        border: '1px solid rgba(224,64,251,0.3)',
                      } : {
                        background: 'rgba(255,255,255,0.03)',
                        color: '#7d8590',
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}
                    >
                      {s}/m
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={toggleRunning}
                disabled={prediction === null}
                className="sm:w-48 py-4 rounded-xl text-base font-black uppercase transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
                style={isRunning ? {
                  background: 'linear-gradient(135deg, #dc2626, #ef4444)',
                  color: '#fff',
                  boxShadow: '0 0 20px rgba(220,38,38,0.4), 0 0 40px rgba(220,38,38,0.1)',
                  border: '1px solid rgba(220,38,38,0.5)',
                } : {
                  background: 'linear-gradient(135deg, #00d4aa, #00b8a9)',
                  color: '#0d1117',
                  boxShadow: '0 0 20px rgba(0,212,170,0.4), 0 0 40px rgba(0,212,170,0.1)',
                  border: '1px solid rgba(0,212,170,0.5)',
                }}
              >
                {isRunning ? '⬛ STOP' : '⚡ TRADE'}
              </button>
            </div>
          </div>

          {/* Right: Stats + Probability Ref */}
          <div className="flex flex-col gap-4">
            {/* Session Stats */}
            <div className="rounded-xl p-4" style={{
              background: 'rgba(22, 27, 34, 0.8)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <span className="text-[10px] text-gray-500 font-bold uppercase block mb-3" style={{ letterSpacing: '0.08em' }}>SESSION STATS</span>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <Trophy className="w-4 h-4 mx-auto mb-1" style={{ color: '#fbbf24' }} />
                  <span className="text-lg font-black font-mono block text-white">{sessionTrades}</span>
                  <span className="text-[9px] text-gray-500">Trades</span>
                </div>
                <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(34,197,94,0.05)' }}>
                  <TrendingUp className="w-4 h-4 mx-auto mb-1" style={{ color: '#22c55e' }} />
                  <span className="text-lg font-black font-mono block" style={{ color: '#22c55e' }}>{sessionWins}</span>
                  <span className="text-[9px] text-gray-500">Wins</span>
                </div>
                <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(239,68,68,0.05)' }}>
                  <AlertTriangle className="w-4 h-4 mx-auto mb-1" style={{ color: '#ef4444' }} />
                  <span className="text-lg font-black font-mono block" style={{ color: '#ef4444' }}>{sessionLosses}</span>
                  <span className="text-[9px] text-gray-500">Losses</span>
                </div>
                <div className="rounded-lg p-3 text-center" style={{
                  background: sessionProfit >= 0 ? 'rgba(34,197,94,0.05)' : 'rgba(239,68,68,0.05)',
                }}>
                  <Target className="w-4 h-4 mx-auto mb-1" style={{ color: sessionProfit >= 0 ? '#22c55e' : '#ef4444' }} />
                  <span className="text-lg font-black font-mono block" style={{
                    color: sessionProfit >= 0 ? '#22c55e' : '#ef4444',
                    textShadow: `0 0 8px ${sessionProfit >= 0 ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
                  }}>
                    {sessionProfit >= 0 ? '+' : ''}{sessionProfit.toFixed(1)}
                  </span>
                  <span className="text-[9px] text-gray-500">Profit (u)</span>
                </div>
              </div>
              {/* Win rate bar */}
              <div className="mt-3">
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-gray-500 font-bold">Win Rate</span>
                  <span className="font-mono font-bold" style={{ color: parseFloat(winRate) >= 50 ? '#22c55e' : '#ef4444' }}>{winRate}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{
                    width: `${sessionTrades > 0 ? (sessionWins / sessionTrades) * 100 : 0}%`,
                    background: `linear-gradient(90deg, ${parseFloat(winRate) >= 50 ? '#22c55e88' : '#ef444488'}, ${parseFloat(winRate) >= 50 ? '#22c55e' : '#ef4444'})`,
                    boxShadow: `0 0 8px ${parseFloat(winRate) >= 50 ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                  }} />
                </div>
              </div>
            </div>

            {/* Probability Reference */}
            <div className="rounded-xl p-4 flex-1" style={{
              background: 'rgba(22, 27, 34, 0.8)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <span className="text-[10px] text-gray-500 font-bold uppercase block mb-3" style={{ letterSpacing: '0.08em' }}>PROBABILITY REFERENCE</span>
              <div className="space-y-1">
                {digitDistribution.map((pct, digit) => {
                  const isSelected = prediction === digit;
                  const isCurrent = digit === currentDigit;
                  return (
                    <div key={digit} className="flex items-center gap-2">
                      <span className={`text-[10px] font-mono w-3 text-right font-bold ${isCurrent ? '' : ''}`} style={{
                        color: isSelected ? '#e040fb' : isCurrent ? '#00d4aa' : '#7d8590',
                      }}>
                        {digit}
                      </span>
                      <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)' }}>
                        <div className="h-full rounded-full transition-all duration-700" style={{
                          width: `${(pct / distMax) * 100}%`,
                          background: isSelected
                            ? 'linear-gradient(90deg, rgba(224,64,251,0.6), #e040fb)'
                            : isCurrent
                              ? 'linear-gradient(90deg, rgba(0,212,170,0.6), #00d4aa)'
                              : `linear-gradient(90deg, rgba(255,255,255,0.15), rgba(255,255,255,0.3))`,
                          boxShadow: isSelected ? '0 0 6px rgba(224,64,251,0.3)' : isCurrent ? '0 0 6px rgba(0,212,170,0.3)' : 'none',
                        }} />
                      </div>
                      <span className="text-[9px] font-mono w-9 text-right" style={{
                        color: isSelected ? '#e040fb' : '#7d8590',
                      }}>{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

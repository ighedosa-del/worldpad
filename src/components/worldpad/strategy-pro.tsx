'use client';

import { useWorldpadStore } from '@/lib/store';
import { useState, useMemo } from 'react';
import { Settings, Zap, Crosshair, Thermometer, ArrowUpDown, RotateCcw, TrendingUp, Play, BarChart3, CheckCircle2, XCircle } from 'lucide-react';

interface Strategy {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  color: string;
  winRate: string;
  backtest: (history: number[]) => { wins: number; losses: number; profit: number; details: { digit: number; won: boolean; expected: number }[] };
}

const STRATEGIES: Strategy[] = [
  {
    id: 'streak-reversal',
    name: 'Streak Reversal',
    description: 'Detects even/odd or over/under streaks and bets on reversal after 3+ consecutive same results.',
    icon: RotateCcw,
    color: '#e040fb',
    winRate: '~62%',
    backtest: (history) => {
      let wins = 0, losses = 0, profit = 0;
      const details: { digit: number; won: boolean; expected: number }[] = [];
      let streakType: string | null = null;
      let streakLen = 0;
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const curr = history[i];
        const prevParity = prev % 2 === 0 ? 'E' : 'O';
        const currParity = curr % 2 === 0 ? 'E' : 'O';
        if (prevParity === streakType) {
          streakLen++;
        } else {
          streakType = prevParity;
          streakLen = 1;
        }
        if (streakLen >= 3) {
          // Bet on reversal
          const expected = streakType === 'E' ? 1 : 0; // odd or even digit
          const won = curr % 2 !== (streakType === 'E' ? 0 : 1);
          if (won) { wins++; profit += 0.85; } else { losses++; profit -= 1; }
          details.push({ digit: curr, won, expected });
          streakLen = 0;
        }
      }
      return { wins, losses, profit, details };
    },
  },
  {
    id: 'hot-digit-chase',
    name: 'Hot Digit Chase',
    description: 'Targets the most frequently appearing digit in the last 50 ticks. Follows the hot streak.',
    icon: Thermometer,
    color: '#ff6b35',
    winRate: '~55%',
    backtest: (history) => {
      let wins = 0, losses = 0, profit = 0;
      const details: { digit: number; won: boolean; expected: number }[] = [];
      for (let i = 50; i < history.length; i++) {
        const window = history.slice(i - 50, i);
        const counts = new Array(10).fill(0);
        window.forEach(d => counts[d]++);
        const hotDigit = counts.indexOf(Math.max(...counts));
        const curr = history[i];
        const won = curr === hotDigit;
        if (won) { wins++; profit += 8.5; } else { losses++; profit -= 1; }
        details.push({ digit: curr, won, expected: hotDigit });
      }
      return { wins, losses, profit, details };
    },
  },
  {
    id: 'cold-digit-snipe',
    name: 'Cold Digit Snipe',
    description: 'Targets the least frequent digit, betting on regression to the mean.',
    icon: Crosshair,
    color: '#00d4aa',
    winRate: '~52%',
    backtest: (history) => {
      let wins = 0, losses = 0, profit = 0;
      const details: { digit: number; won: boolean; expected: number }[] = [];
      for (let i = 50; i < history.length; i++) {
        const window = history.slice(i - 50, i);
        const counts = new Array(10).fill(0);
        window.forEach(d => counts[d]++);
        const coldDigit = counts.indexOf(Math.min(...counts));
        const curr = history[i];
        const won = curr === coldDigit;
        if (won) { wins++; profit += 8.5; } else { losses++; profit -= 1; }
        details.push({ digit: curr, won, expected: coldDigit });
      }
      return { wins, losses, profit, details };
    },
  },
  {
    id: 'barrier-shift',
    name: 'Barrier Shift',
    description: 'Dynamically adjusts over/under barrier based on recent digit mean.',
    icon: ArrowUpDown,
    color: '#fbbf24',
    winRate: '~58%',
    backtest: (history) => {
      let wins = 0, losses = 0, profit = 0;
      const details: { digit: number; won: boolean; expected: number }[] = [];
      for (let i = 30; i < history.length; i++) {
        const window = history.slice(i - 30, i);
        const mean = window.reduce((a, b) => a + b, 0) / window.length;
        const barrier = Math.round(mean);
        const curr = history[i];
        // Bet over if mean is low, under if high
        const betOver = mean < 4.5;
        const won = betOver ? curr > barrier : curr < barrier;
        if (won) { wins++; profit += 0.85; } else { losses++; profit -= 1; }
        details.push({ digit: curr, won, expected: barrier });
      }
      return { wins, losses, profit, details };
    },
  },
  {
    id: 'momentum-trade',
    name: 'Momentum Trade',
    description: 'Uses rise/fall direction patterns to predict next digit direction.',
    icon: TrendingUp,
    color: '#22c55e',
    winRate: '~56%',
    backtest: (history) => {
      let wins = 0, losses = 0, profit = 0;
      const details: { digit: number; won: boolean; expected: number }[] = [];
      for (let i = 3; i < history.length; i++) {
        const prev = history[i - 1];
        const prev2 = history[i - 2];
        const curr = history[i];
        // Detect momentum: if last 2 digits both rose or both fell, follow direction
        const dir1 = history[i - 1] > history[i - 2] ? 'R' : 'F';
        const dir2 = history[i - 2] > history[i - 3] ? 'R' : 'F';
        if (dir1 === dir2) {
          const betRise = dir1 === 'R';
          const actualRise = curr > prev;
          const won = betRise === actualRise;
          if (won) { wins++; profit += 0.85; } else { losses++; profit -= 1; }
          details.push({ digit: curr, won, expected: betRise ? 1 : 0 });
        }
      }
      return { wins, losses, profit, details };
    },
  },
  {
    id: 'contrarian',
    name: 'Contrarian',
    description: 'Bets against the dominant trend. If over is dominant, bet under, and vice versa.',
    icon: Zap,
    color: '#ef4444',
    winRate: '~54%',
    backtest: (history) => {
      let wins = 0, losses = 0, profit = 0;
      const details: { digit: number; won: boolean; expected: number }[] = [];
      for (let i = 20; i < history.length; i++) {
        const window = history.slice(i - 20, i);
        const overCount = window.filter(d => d >= 5).length;
        const underCount = 20 - overCount;
        const dominant = overCount > underCount ? 'O' : 'U';
        const curr = history[i];
        // Bet against dominant
        const betOver = dominant === 'U';
        const won = betOver ? curr >= 5 : curr < 5;
        if (won) { wins++; profit += 0.85; } else { losses++; profit -= 1; }
        details.push({ digit: curr, won, expected: betOver ? 5 : 4 });
      }
      return { wins, losses, profit, details };
    },
  },
];

export function StrategyPro() {
  const { digitHistory } = useWorldpadStore();
  const [loadedStrategy, setLoadedStrategy] = useState<string | null>(null);

  const backtestResult = useMemo(() => {
    if (!loadedStrategy || digitHistory.length < 10) return null;
    const strategy = STRATEGIES.find(s => s.id === loadedStrategy);
    if (!strategy) return null;
    return strategy.backtest(digitHistory);
  }, [loadedStrategy, digitHistory]);

  return (
    <div className="h-[calc(100vh-52px)] flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto wp-scroll p-4 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5" style={{ color: '#fbbf24' }} />
          <h2 className="text-xs font-bold text-white uppercase tracking-wide" style={{ letterSpacing: '0.08em' }}>
            STRATEGY PRO
          </h2>
          <span className="text-[10px] text-gray-500 ml-auto font-mono">
            {digitHistory.length} ticks available
          </span>
        </div>

        {/* Strategy Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {STRATEGIES.map((strategy) => {
            const Icon = strategy.icon;
            const isLoaded = loadedStrategy === strategy.id;
            return (
              <div
                key={strategy.id}
                className="rounded-xl p-4 flex flex-col gap-3 transition-all duration-200 hover:border-opacity-20"
                style={{
                  background: 'rgba(22, 27, 34, 0.8)',
                  border: isLoaded
                    ? `1px solid ${strategy.color}66`
                    : '1px solid rgba(255,255,255,0.06)',
                  boxShadow: isLoaded ? `0 0 20px ${strategy.color}15` : 'none',
                }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{
                      background: `${strategy.color}15`,
                      border: `1px solid ${strategy.color}25`,
                    }}>
                      <Icon className="w-4 h-4" style={{ color: strategy.color }} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">{strategy.name}</h3>
                      <span className="text-[10px] font-mono font-bold" style={{ color: strategy.color }}>
                        Est. {strategy.winRate}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-gray-500 leading-relaxed flex-1">{strategy.description}</p>
                <button
                  onClick={() => setLoadedStrategy(isLoaded ? null : strategy.id)}
                  className="w-full py-2 rounded-lg text-xs font-bold transition-all duration-200"
                  style={isLoaded ? {
                    background: `${strategy.color}20`,
                    color: strategy.color,
                    border: `1px solid ${strategy.color}40`,
                  } : {
                    background: `${strategy.color}10`,
                    color: `${strategy.color}cc`,
                    border: `1px solid ${strategy.color}20`,
                  }}
                >
                  {isLoaded ? '✓ Loaded' : 'Load Strategy'}
                </button>
              </div>
            );
          })}
        </div>

        {/* Backtest Results Panel */}
        {loadedStrategy && backtestResult && (
          <div className="rounded-xl p-4" style={{
            background: 'rgba(22, 27, 34, 0.8)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div className="flex items-center gap-3 mb-4">
              <BarChart3 className="w-4 h-4" style={{ color: '#00d4aa' }} />
              <h3 className="text-xs font-bold text-white uppercase tracking-wide" style={{ letterSpacing: '0.08em' }}>
                BACKTEST RESULTS — {STRATEGIES.find(s => s.id === loadedStrategy)?.name}
              </h3>
              <span className="text-[10px] text-gray-500 ml-auto font-mono">
                {backtestResult.wins + backtestResult.losses} trades
              </span>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="rounded-lg p-3" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.15)' }}>
                <span className="text-[10px] text-gray-500 font-bold uppercase block">Wins</span>
                <span className="text-lg font-black font-mono" style={{ color: '#22c55e', textShadow: '0 0 8px rgba(34,197,94,0.4)' }}>{backtestResult.wins}</span>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
                <span className="text-[10px] text-gray-500 font-bold uppercase block">Losses</span>
                <span className="text-lg font-black font-mono" style={{ color: '#ef4444', textShadow: '0 0 8px rgba(239,68,68,0.4)' }}>{backtestResult.losses}</span>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'rgba(0,212,170,0.08)', border: '1px solid rgba(0,212,170,0.15)' }}>
                <span className="text-[10px] text-gray-500 font-bold uppercase block">Win Rate</span>
                <span className="text-lg font-black font-mono" style={{ color: '#00d4aa', textShadow: '0 0 8px rgba(0,212,170,0.4)' }}>
                  {backtestResult.wins + backtestResult.losses > 0
                    ? ((backtestResult.wins / (backtestResult.wins + backtestResult.losses)) * 100).toFixed(1)
                    : 0}%
                </span>
              </div>
              <div className="rounded-lg p-3" style={{
                background: backtestResult.profit >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                border: `1px solid ${backtestResult.profit >= 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}`,
              }}>
                <span className="text-[10px] text-gray-500 font-bold uppercase block">Sim. Profit</span>
                <span className="text-lg font-black font-mono" style={{
                  color: backtestResult.profit >= 0 ? '#22c55e' : '#ef4444',
                  textShadow: `0 0 8px ${backtestResult.profit >= 0 ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
                }}>
                  {backtestResult.profit >= 0 ? '+' : ''}{backtestResult.profit.toFixed(2)}u
                </span>
              </div>
            </div>

            {/* Recent trade results strip */}
            <div>
              <span className="text-[10px] text-gray-500 font-bold uppercase block mb-2" style={{ letterSpacing: '0.08em' }}>
                RECENT TRADES
              </span>
              <div className="flex gap-1 flex-wrap max-h-24 overflow-y-auto wp-scroll">
                {backtestResult.details.slice(-60).map((d, i) => (
                  <div
                    key={i}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-bold transition-all hover:scale-110"
                    style={{
                      background: d.won ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                      color: d.won ? '#22c55e' : '#ef4444',
                      border: `1px solid ${d.won ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                    }}
                    title={`Digit: ${d.digit} | ${d.won ? 'WIN' : 'LOSS'}`}
                  >
                    {d.won ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* No strategy loaded hint */}
        {!loadedStrategy && (
          <div className="rounded-xl p-6 flex flex-col items-center justify-center gap-2" style={{
            background: 'rgba(22, 27, 34, 0.5)',
            border: '1px solid rgba(255,255,255,0.04)',
          }}>
            <Play className="w-8 h-8 text-gray-700" />
            <span className="text-xs text-gray-600">Select a strategy above to see backtest results</span>
            <span className="text-[10px] text-gray-700">Requires at least 10 ticks of digit history</span>
          </div>
        )}
      </div>
    </div>
  );
}

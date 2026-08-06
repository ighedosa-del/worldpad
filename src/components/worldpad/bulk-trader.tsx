'use client';

import { useWorldpadStore } from '@/lib/store';
import { useState, useMemo } from 'react';
import { Layers, Zap, CheckCircle2, XCircle, DollarSign, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface DigitBet {
  digit: number;
  enabled: boolean;
  type: 'MATCH' | 'DIFFER';
  stake: number;
}

interface BulkResult {
  digit: number;
  type: 'MATCH' | 'DIFFER';
  stake: number;
  targetDigit: number;
  actualDigit: number;
  won: boolean;
  payout: number;
  profit: number;
  timestamp: number;
}

const MATCH_PAYOUT = 8.5;
const DIFFER_PAYOUT = 0.85;

export function BulkTrader() {
  const { currentDigit, tradeHistory } = useWorldpadStore();

  const [bets, setBets] = useState<DigitBet[]>(() =>
    Array.from({ length: 10 }, (_, i) => ({
      digit: i,
      enabled: false,
      type: 'MATCH',
      stake: 0.35,
    }))
  );
  const [results, setResults] = useState<BulkResult[]>([]);
  const [isTrading, setIsTrading] = useState(false);

  const enabledBets = useMemo(() => bets.filter(b => b.enabled), [bets]);

  const totalStake = useMemo(() => enabledBets.reduce((sum, b) => sum + b.stake, 0), [enabledBets]);

  const totalPotentialPayout = useMemo(() => {
    return enabledBets.reduce((sum, b) => {
      return sum + (b.type === 'MATCH' ? b.stake * MATCH_PAYOUT : b.stake * DIFFER_PAYOUT);
    }, 0);
  }, [enabledBets]);

  const toggleBet = (digit: number) => {
    setBets(prev => prev.map(b => b.digit === digit ? { ...b, enabled: !b.enabled } : b));
  };

  const toggleType = (digit: number) => {
    setBets(prev => prev.map(b => b.digit === digit ? { ...b, type: b.type === 'MATCH' ? 'DIFFER' : 'MATCH' } : b));
  };

  const setStake = (digit: number, stake: number) => {
    setBets(prev => prev.map(b => b.digit === digit ? { ...b, stake } : b));
  };

  const enableAll = () => setBets(prev => prev.map(b => ({ ...b, enabled: true })));
  const disableAll = () => setBets(prev => prev.map(b => ({ ...b, enabled: false })));

  const setAllStakes = (stake: number) => {
    setBets(prev => prev.map(b => ({ ...b, stake })));
  };

  const executeTradeAll = () => {
    if (enabledBets.length === 0) return;
    setIsTrading(true);

    // Simulate using current digit
    const newResults: BulkResult[] = enabledBets.map(bet => {
      const won = bet.type === 'MATCH'
        ? currentDigit === bet.digit
        : currentDigit !== bet.digit;
      const payout = won
        ? bet.type === 'MATCH' ? bet.stake * MATCH_PAYOUT : bet.stake * DIFFER_PAYOUT
        : 0;
      const profit = payout - bet.stake;
      return {
        digit: bet.digit,
        type: bet.type,
        stake: bet.stake,
        targetDigit: bet.digit,
        actualDigit: currentDigit,
        won,
        payout,
        profit,
        timestamp: Date.now(),
      };
    });

    setResults(prev => [...newResults, ...prev].slice(0, 100));
    setIsTrading(false);
  };

  const totalProfit = useMemo(() => results.reduce((sum, r) => sum + r.profit, 0), [results]);
  const totalWins = useMemo(() => results.filter(r => r.won).length, [results]);
  const totalLosses = useMemo(() => results.filter(r => !r.won).length, [results]);

  return (
    <div className="h-[calc(100vh-52px)] flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto wp-scroll p-4 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Layers className="w-5 h-5" style={{ color: '#ff6b35' }} />
          <h2 className="text-xs font-bold text-white uppercase tracking-wide" style={{ letterSpacing: '0.08em' }}>
            BULK TRADER
          </h2>
          <span className="text-[10px] text-gray-500 ml-auto font-mono">
            {enabledBets.length}/10 digits active
          </span>
        </div>

        {/* Summary bar */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl p-3 text-center" style={{
            background: 'rgba(22, 27, 34, 0.8)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <span className="text-[10px] text-gray-500 font-bold uppercase block">Total Stake</span>
            <span className="text-lg font-black font-mono" style={{ color: '#fbbf24', textShadow: '0 0 8px rgba(251,191,36,0.4)' }}>
              ${totalStake.toFixed(2)}
            </span>
          </div>
          <div className="rounded-xl p-3 text-center" style={{
            background: 'rgba(22, 27, 34, 0.8)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <span className="text-[10px] text-gray-500 font-bold uppercase block">Max Payout</span>
            <span className="text-lg font-black font-mono" style={{ color: '#22c55e', textShadow: '0 0 8px rgba(34,197,94,0.4)' }}>
              ${totalPotentialPayout.toFixed(2)}
            </span>
          </div>
          <div className="rounded-xl p-3 text-center" style={{
            background: 'rgba(22, 27, 34, 0.8)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <span className="text-[10px] text-gray-500 font-bold uppercase block">Session P/L</span>
            <span className="text-lg font-black font-mono" style={{
              color: totalProfit >= 0 ? '#22c55e' : '#ef4444',
              textShadow: `0 0 8px ${totalProfit >= 0 ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
            }}>
              {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={enableAll} className="text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all" style={{
            background: 'rgba(0,212,170,0.1)',
            color: '#00d4aa',
            border: '1px solid rgba(0,212,170,0.2)',
          }}>Enable All</button>
          <button onClick={disableAll} className="text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all" style={{
            background: 'rgba(239,68,68,0.1)',
            color: '#ef4444',
            border: '1px solid rgba(239,68,68,0.2)',
          }}>Disable All</button>
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-[10px] text-gray-500 font-bold">All Stakes:</span>
            {[0.1, 0.35, 0.5, 1].map(s => (
              <button key={s} onClick={() => setAllStakes(s)} className="text-[10px] font-mono px-2 py-1 rounded transition-all" style={{
                background: 'rgba(255,255,255,0.04)',
                color: '#7d8590',
                border: '1px solid rgba(255,255,255,0.06)',
              }}>${s}</button>
            ))}
          </div>
        </div>

        {/* Digit Grid */}
        <div className="rounded-xl p-4" style={{
          background: 'rgba(22, 27, 34, 0.8)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <h3 className="text-xs font-bold text-white uppercase tracking-wide mb-3" style={{ letterSpacing: '0.08em' }}>
            DIGIT BETS
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {bets.map(bet => {
              const isCurrent = bet.digit === currentDigit;
              return (
                <div
                  key={bet.digit}
                  className={`rounded-lg p-3 flex flex-col gap-2 transition-all duration-200 ${bet.enabled ? '' : 'opacity-40'}`}
                  style={{
                    background: bet.enabled ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.01)',
                    border: bet.enabled
                      ? `1px solid ${isCurrent ? 'rgba(0,212,170,0.4)' : 'rgba(255,255,255,0.1)'}`
                      : '1px solid rgba(255,255,255,0.04)',
                    boxShadow: bet.enabled && isCurrent ? '0 0 12px rgba(0,212,170,0.15)' : 'none',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-base font-black font-mono ${isCurrent ? '' : ''}`} style={{
                        color: isCurrent ? '#00d4aa' : bet.enabled ? 'white' : '#7d8590',
                        textShadow: isCurrent ? '0 0 8px rgba(0,212,170,0.5)' : 'none',
                      }}>
                        {bet.digit}
                      </span>
                      {/* Type toggle */}
                      <button
                        onClick={() => toggleType(bet.digit)}
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded transition-all"
                        style={{
                          background: bet.type === 'MATCH' ? 'rgba(239,68,68,0.15)' : 'rgba(139,92,246,0.15)',
                          color: bet.type === 'MATCH' ? '#ef4444' : '#8b5cf6',
                          border: `1px solid ${bet.type === 'MATCH' ? 'rgba(239,68,68,0.25)' : 'rgba(139,92,246,0.25)'}`,
                        }}
                      >
                        {bet.type}
                      </button>
                    </div>
                    {/* Enable checkbox */}
                    <button
                      onClick={() => toggleBet(bet.digit)}
                      className="w-5 h-5 rounded flex items-center justify-center transition-all"
                      style={{
                        background: bet.enabled ? 'rgba(0,212,170,0.2)' : 'rgba(255,255,255,0.04)',
                        border: bet.enabled ? '1.5px solid rgba(0,212,170,0.5)' : '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      {bet.enabled && <CheckCircle2 className="w-3.5 h-3.5" style={{ color: '#00d4aa' }} />}
                    </button>
                  </div>
                  {/* Stake input */}
                  <div className="flex items-center gap-1">
                    <DollarSign className="w-3 h-3 text-gray-600" />
                    <input
                      type="number"
                      step="0.05"
                      min="0.05"
                      value={bet.stake}
                      onChange={(e) => setStake(bet.digit, parseFloat(e.target.value) || 0.35)}
                      className="flex-1 text-white text-xs px-2 py-1.5 rounded font-mono outline-none"
                      style={{
                        background: 'rgba(0,0,0,0.4)',
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* TRADE ALL button */}
        <button
          onClick={executeTradeAll}
          disabled={enabledBets.length === 0 || isTrading}
          className="w-full py-4 rounded-xl text-base font-black uppercase transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background: 'linear-gradient(135deg, #ff6b35, #e040fb)',
            color: '#0d1117',
            boxShadow: '0 0 24px rgba(255,107,53,0.3), 0 0 48px rgba(224,64,251,0.1)',
            border: '1px solid rgba(255,107,53,0.4)',
          }}
        >
          <span className="flex items-center justify-center gap-2">
            <Zap className="w-5 h-5" />
            TRADE ALL ({enabledBets.length})
          </span>
        </button>

        {/* Results Log */}
        {results.length > 0 && (
          <div className="rounded-xl p-4" style={{
            background: 'rgba(22, 27, 34, 0.8)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wide" style={{ letterSpacing: '0.08em' }}>
                RESULTS LOG
              </h3>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono" style={{ color: '#22c55e' }}>W: {totalWins}</span>
                <span className="text-[10px] font-mono" style={{ color: '#ef4444' }}>L: {totalLosses}</span>
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto wp-scroll space-y-1">
              {results.map((r, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all"
                  style={{
                    background: r.won ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                    border: `1px solid ${r.won ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}`,
                  }}
                >
                  {r.won
                    ? <ArrowUpRight className="w-3.5 h-3.5" style={{ color: '#22c55e' }} />
                    : <ArrowDownRight className="w-3.5 h-3.5" style={{ color: '#ef4444' }} />
                  }
                  <span className="text-[11px] font-bold" style={{ color: r.won ? '#22c55e' : '#ef4444' }}>
                    {r.type} D{r.digit}
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">Result: {r.actualDigit}</span>
                  <span className="text-[10px] text-gray-500 ml-auto">${r.stake.toFixed(2)}</span>
                  <span className="text-[11px] font-mono font-bold ml-auto" style={{
                    color: r.profit >= 0 ? '#22c55e' : '#ef4444',
                  }}>
                    {r.profit >= 0 ? '+' : ''}{r.profit.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

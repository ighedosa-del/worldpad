'use client';

import { useState, useMemo } from 'react';
import { Users, Copy, Check, TrendingUp, Crown, Star, X, Wallet } from 'lucide-react';
import { useWorldpadStore } from '@/lib/store';

interface TraderProfile {
  id: string;
  name: string;
  winRate: number;
  totalTrades: number;
  profit: number;
  streak: number;
  rank: number;
  color: string;
  copied: boolean;
}

const TRADERS: TraderProfile[] = [
  { id: 't1', name: 'AlphaDigit', winRate: 78.5, totalTrades: 1243, profit: 3420.50, streak: 12, rank: 1, color: '#fbbf24', copied: false },
  { id: 't2', name: 'VolatilityKing', winRate: 72.3, totalTrades: 891, profit: 2150.80, streak: 8, rank: 2, color: '#c0c0c0', copied: false },
  { id: 't3', name: 'DigitMaster99', winRate: 69.8, totalTrades: 2104, profit: 1890.25, streak: 6, rank: 3, color: '#cd7f32', copied: false },
  { id: 't4', name: 'EvenOddPro', winRate: 67.1, totalTrades: 576, profit: 1245.60, streak: 5, rank: 4, color: '#00d4aa', copied: false },
  { id: 't5', name: 'ScalpHunter', winRate: 65.4, totalTrades: 3450, profit: 980.30, streak: 4, rank: 5, color: '#e040fb', copied: false },
  { id: 't6', name: 'RiseFallGuru', winRate: 63.7, totalTrades: 1567, profit: 756.90, streak: 3, rank: 6, color: '#ff6b35', copied: false },
];

export function CopyTrader() {
  const { isAuthorized } = useWorldpadStore();
  const [traders, setTraders] = useState<TraderProfile[]>(TRADERS);
  const [showLoginToast, setShowLoginToast] = useState(false);

  const copiedTraders = useMemo(() => traders.filter(t => t.copied), [traders]);

  const handleCopy = (traderId: string) => {
    if (!isAuthorized) {
      setShowLoginToast(true);
      setTimeout(() => setShowLoginToast(false), 2500);
      return;
    }
    setTraders(prev => prev.map(t =>
      t.id === traderId ? { ...t, copied: !t.copied } : t
    ));
  };

  const getRankBadge = (rank: number, color: string) => {
    if (rank === 1) return <Crown className="w-4 h-4" style={{ color }} />;
    if (rank === 2) return <Crown className="w-4 h-4" style={{ color, opacity: 0.7 }} />;
    if (rank === 3) return <Crown className="w-4 h-4" style={{ color, opacity: 0.5 }} />;
    return <span className="text-xs font-bold text-gray-500">#{rank}</span>;
  };

  return (
    <div className="h-[calc(100vh-52px)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{
        background: 'rgba(22, 27, 34, 0.8)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full" style={{
            background: 'rgba(0,212,170,0.1)',
            border: '1px solid rgba(0,212,170,0.2)',
          }}>
            <Users className="w-3.5 h-3.5 text-[#00d4aa]" style={{ filter: 'drop-shadow(0 0 4px rgba(0,212,170,0.5))' }} />
            <span className="text-[10px] font-bold text-[#00d4aa]" style={{ textShadow: '0 0 6px rgba(0,212,170,0.4)' }}>COPY TRADER</span>
          </div>
          <span className="text-[10px] text-gray-500 font-mono">{traders.length} traders available</span>
        </div>
        {showLoginToast && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-red-400 animate-pulse" style={{
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.2)',
          }}>
            Login required to copy traders
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto wp-scroll p-4 flex flex-col gap-6">
        {/* Top Traders Section */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Star className="w-4 h-4 text-yellow-400" style={{ filter: 'drop-shadow(0 0 4px rgba(250,204,21,0.5))' }} />
            <h2 className="text-sm font-bold text-white">Top Traders</h2>
          </div>

          <div className="flex flex-col gap-3">
            {traders.map((trader, i) => (
              <div
                key={trader.id}
                className="rounded-xl p-4 flex items-center gap-4 group transition-all duration-300 hover:translate-y-[-1px]"
                style={{
                  background: trader.rank === 1
                    ? 'linear-gradient(135deg, rgba(251,191,36,0.06), rgba(22, 27, 34, 0.8))'
                    : 'rgba(22, 27, 34, 0.8)',
                  border: trader.rank === 1
                    ? '1px solid rgba(251,191,36,0.15)'
                    : '1px solid rgba(255,255,255,0.06)',
                  boxShadow: trader.rank === 1
                    ? '0 0 20px rgba(251,191,36,0.05)'
                    : 'none',
                }}
              >
                {/* Rank Badge */}
                <div className="shrink-0 flex items-center justify-center w-8">
                  {getRankBadge(trader.rank, trader.color)}
                </div>

                {/* Avatar Circle */}
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-black text-white transition-transform duration-300 group-hover:scale-110"
                  style={{
                    background: `linear-gradient(135deg, ${trader.color}33, ${trader.color}11)`,
                    border: `2px solid ${trader.color}44`,
                    boxShadow: `0 0 12px ${trader.color}22`,
                  }}
                >
                  {trader.name.charAt(0).toUpperCase()}
                </div>

                {/* Trader Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-bold text-white truncate">{trader.name}</h3>
                    {trader.streak >= 5 && (
                      <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold text-yellow-400" style={{
                        background: 'rgba(245,158,11,0.12)',
                        border: '1px solid rgba(245,158,11,0.2)',
                      }}>
                        <TrendingUp className="w-2.5 h-2.5" />
                        {trader.streak} streak
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-gray-500">
                    <span>{trader.totalTrades.toLocaleString()} trades</span>
                    <span className="text-gray-600">•</span>
                    <span className={trader.profit >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {trader.profit >= 0 ? '+' : ''}${trader.profit.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Win Rate + Copy Button */}
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="text-base font-black font-mono" style={{
                      color: trader.winRate >= 70 ? '#00d4aa' : trader.winRate >= 65 ? '#fbbf24' : '#7d8590',
                      textShadow: trader.winRate >= 70 ? '0 0 8px rgba(0,212,170,0.4)' : 'none',
                    }}>
                      {trader.winRate.toFixed(1)}%
                    </div>
                    <div className="text-[9px] text-gray-600 font-medium">WIN RATE</div>
                  </div>

                  <button
                    onClick={() => handleCopy(trader.id)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
                      trader.copied
                        ? 'text-[#0d1117]'
                        : 'text-white hover:translate-y-[-1px]'
                    }`}
                    style={trader.copied ? {
                      background: 'linear-gradient(135deg, #00d4aa, #00b8a9)',
                      boxShadow: '0 0 12px rgba(0,212,170,0.3)',
                    } : {
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}
                  >
                    {trader.copied ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* My Copy Trades Section */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Wallet className="w-4 h-4 text-[#e040fb]" style={{ filter: 'drop-shadow(0 0 4px rgba(224,64,251,0.5))' }} />
            <h2 className="text-sm font-bold text-white">My Copy Trades</h2>
            {copiedTraders.length > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold text-[#e040fb]" style={{
                background: 'rgba(224,64,251,0.1)',
                border: '1px solid rgba(224,64,251,0.2)',
              }}>{copiedTraders.length}</span>
            )}
          </div>

          {copiedTraders.length === 0 ? (
            <div className="rounded-xl p-6 flex flex-col items-center gap-3 text-center" style={{
              background: 'rgba(22, 27, 34, 0.5)',
              border: '1px dashed rgba(255,255,255,0.08)',
            }}>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}>
                <Users className="w-5 h-5 text-gray-600" />
              </div>
              <p className="text-xs text-gray-500">No active copy relationships</p>
              <p className="text-[10px] text-gray-600">Click &quot;Copy&quot; on a trader above to start copying their trades</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {copiedTraders.map((trader) => (
                <div
                  key={trader.id}
                  className="rounded-xl p-3 flex items-center gap-3 transition-all duration-200"
                  style={{
                    background: 'rgba(22, 27, 34, 0.8)',
                    border: '1px solid rgba(0,212,170,0.15)',
                    boxShadow: '0 0 12px rgba(0,212,170,0.05)',
                  }}
                >
                  <div className="w-1 h-8 rounded-full" style={{ background: '#00d4aa', boxShadow: '0 0 6px rgba(0,212,170,0.4)' }} />
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-white"
                    style={{
                      background: `linear-gradient(135deg, ${trader.color}33, ${trader.color}11)`,
                      border: `1.5px solid ${trader.color}44`,
                    }}
                  >
                    {trader.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">{trader.name}</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" style={{ boxShadow: '0 0 6px rgba(34,197,94,0.6)' }} />
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-gray-500">
                      <span>{trader.winRate.toFixed(1)}% win</span>
                      <span className="text-gray-600">•</span>
                      <span className="text-green-400">+${trader.profit.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="px-2 py-1 rounded text-[9px] font-bold text-green-400" style={{
                      background: 'rgba(34,197,94,0.1)',
                      border: '1px solid rgba(34,197,94,0.15)',
                    }}>ACTIVE</div>
                    <button
                      onClick={() => handleCopy(trader.id)}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-[rgba(239,68,68,0.1)] transition-all duration-200"
                      style={{ border: '1px solid transparent' }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

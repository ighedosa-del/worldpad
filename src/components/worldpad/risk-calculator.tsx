'use client';

import { useWorldpadStore } from '@/lib/store';
import { useState, useMemo } from 'react';
import { Shield, AlertTriangle, TrendingUp, Calculator, Target, Zap } from 'lucide-react';

function GlowStatBox({ label, value, sub, color, icon: Icon }: {
  label: string; value: string; sub?: string; color: string; icon: React.ElementType;
}) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-2" style={{
      background: 'rgba(22, 27, 34, 0.8)',
      border: `1px solid ${color}22`,
      boxShadow: `0 0 20px ${color}08, inset 0 1px 0 ${color}10`,
    }}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" style={{ color }} />
        <span className="text-[10px] text-gray-500 font-bold uppercase" style={{ letterSpacing: '0.08em' }}>{label}</span>
      </div>
      <span className="text-xl font-black font-mono" style={{ color, textShadow: `0 0 12px ${color}50` }}>{value}</span>
      {sub && <span className="text-[10px] text-gray-600">{sub}</span>}
    </div>
  );
}

export function RiskCalculator() {
  const { balance, botConfig } = useWorldpadStore();

  const [accountBalance, setAccountBalance] = useState(balance);
  const [riskPct, setRiskPct] = useState(2);
  const [stopLoss, setStopLoss] = useState(botConfig.stopLoss || 50);
  const [riskReward, setRiskReward] = useState(2);
  const [avgPayout, setAvgPayout] = useState(0.85);

  const results = useMemo(() => {
    const maxStake = (accountBalance * riskPct) / 100;
    const expectedLossesBeforeStop = Math.floor(stopLoss / maxStake);
    const totalRiskPerCycle = maxStake * expectedLossesBeforeStop;
    const requiredWinRate = 1 / (1 + riskReward) * 100;
    
    // Martingale multiplier: ensures recovery after N consecutive losses
    // Sum of geometric series: stake * (m^(n+1) - 1) / (m - 1) = stopLoss
    // For simple case, we use formula: m = ((stopLoss/maxStake) * (m-1) + 1)^(1/n)
    // Simplified: m ≈ 1 + (stopLoss / (maxStake * expectedLossesBeforeStop))
    let suggestedMartingale: number;
    if (expectedLossesBeforeStop <= 1) {
      suggestedMartingale = 2.0;
    } else {
      // Geometric mean approach: total loss over N steps should not exceed stopLoss
      // stake * sum(m^i for i=0..N-1) <= stopLoss
      // Approximate: m <= (1 + stopLoss/(stake*N))^(N/(N-1))
      const ratio = 1 + stopLoss / (maxStake * expectedLossesBeforeStop);
      suggestedMartingale = Math.pow(ratio, expectedLossesBeforeStop / (expectedLossesBeforeStop - 1));
      suggestedMartingale = Math.min(Math.max(suggestedMartingale, 1.5), 5.0);
      suggestedMartingale = Math.round(suggestedMartingale * 100) / 100;
    }

    const maxProfit = maxStake * avgPayout;
    const maxLoss = maxStake;
    const breakEvenWins = Math.ceil(expectedLossesBeforeStop / (avgPayout * riskReward) + 1);
    const dailyTrades = Math.floor(stopLoss / maxStake);
    const expectedDailyProfit = dailyTrades * (maxProfit * (1 / riskReward) - maxLoss * ((riskReward - 1) / riskReward));

    return {
      maxStake,
      expectedLossesBeforeStop,
      totalRiskPerCycle,
      requiredWinRate,
      suggestedMartingale,
      maxProfit,
      maxLoss,
      breakEvenWins,
      dailyTrades,
      expectedDailyProfit,
    };
  }, [accountBalance, riskPct, stopLoss, riskReward, avgPayout]);

  const inputClass = "w-full text-white text-sm px-3 py-2.5 rounded-lg outline-none transition-all duration-200 font-mono";
  const inputStyle = {
    background: 'rgba(0, 0, 0, 0.4)',
    border: '1px solid rgba(255,255,255,0.1)',
  };

  return (
    <div className="h-[calc(100vh-52px)] flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto wp-scroll p-4 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5" style={{ color: '#ff6b35' }} />
          <h2 className="text-xs font-bold text-white uppercase tracking-wide" style={{ letterSpacing: '0.08em' }}>
            RISK CALCULATOR
          </h2>
          <span className="text-[10px] text-gray-500 ml-auto font-mono">Real-time</span>
        </div>

        {/* Input Panel */}
        <div className="rounded-xl p-4 flex flex-col gap-4" style={{
          background: 'rgba(22, 27, 34, 0.8)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <h3 className="text-xs font-bold text-white uppercase tracking-wide" style={{ letterSpacing: '0.08em' }}>
            PARAMETERS
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-gray-500 font-bold uppercase" style={{ letterSpacing: '0.08em' }}>
                Account Balance ($)
              </label>
              <input
                type="number"
                value={accountBalance}
                onChange={(e) => setAccountBalance(parseFloat(e.target.value) || 0)}
                className={inputClass}
                style={inputStyle}
              />
              <button
                onClick={() => setAccountBalance(balance)}
                className="text-[10px] font-bold self-start" style={{ color: '#00d4aa' }}
              >
                Sync from store (${balance.toFixed(2)})
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-gray-500 font-bold uppercase" style={{ letterSpacing: '0.08em' }}>
                Risk Per Trade (%)
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="100"
                value={riskPct}
                onChange={(e) => setRiskPct(parseFloat(e.target.value) || 0)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-gray-500 font-bold uppercase" style={{ letterSpacing: '0.08em' }}>
                Stop Loss ($)
              </label>
              <input
                type="number"
                value={stopLoss}
                onChange={(e) => setStopLoss(parseFloat(e.target.value) || 0)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-gray-500 font-bold uppercase" style={{ letterSpacing: '0.08em' }}>
                Risk / Reward Ratio
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={riskReward}
                onChange={(e) => setRiskReward(parseFloat(e.target.value) || 1)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-gray-500 font-bold uppercase" style={{ letterSpacing: '0.08em' }}>
                Avg Payout Multiplier
              </label>
              <input
                type="number"
                step="0.01"
                min="0.1"
                max="10"
                value={avgPayout}
                onChange={(e) => setAvgPayout(parseFloat(e.target.value) || 0.5)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
          </div>
        </div>

        {/* Results Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <GlowStatBox
            label="Max Stake"
            value={`$${results.maxStake.toFixed(2)}`}
            sub={`${riskPct}% of $${accountBalance.toFixed(2)}`}
            color="#00d4aa"
            icon={Target}
          />
          <GlowStatBox
            label="Expected Losses"
            value={results.expectedLossesBeforeStop.toString()}
            sub="Before stop loss triggers"
            color="#ff6b35"
            icon={AlertTriangle}
          />
          <GlowStatBox
            label="Martingale Mult."
            value={`x${results.suggestedMartingale.toFixed(2)}`}
            sub={`Recovers in ${Math.min(results.expectedLossesBeforeStop, 5)} wins`}
            color="#e040fb"
            icon={Zap}
          />
          <GlowStatBox
            label="Required Win Rate"
            value={`${results.requiredWinRate.toFixed(1)}%`}
            sub={`At 1:${riskReward} R:R`}
            color="#fbbf24"
            icon={TrendingUp}
          />
          <GlowStatBox
            label="Max Profit / Trade"
            value={`$${results.maxProfit.toFixed(2)}`}
            sub={`Max Loss: $${results.maxLoss.toFixed(2)}`}
            color="#22c55e"
            icon={TrendingUp}
          />
          <GlowStatBox
            label="Break-even After"
            value={`${results.breakEvenWins} wins`}
            sub={results.expectedLossesBeforeStop > 0 ? `after ${results.expectedLossesBeforeStop} losses` : 'Set stop loss'}
            color="#8b5cf6"
            icon={Calculator}
          />
        </div>

        {/* Risk Summary Bar */}
        <div className="rounded-xl p-4" style={{
          background: 'rgba(22, 27, 34, 0.8)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <h3 className="text-xs font-bold text-white uppercase tracking-wide mb-3" style={{ letterSpacing: '0.08em' }}>
            RISK VISUALIZATION
          </h3>
          <div className="space-y-3">
            {/* Risk gauge */}
            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-gray-500 font-bold">Risk Level</span>
                <span className="font-mono font-bold" style={{
                  color: riskPct <= 2 ? '#22c55e' : riskPct <= 5 ? '#eab308' : '#ef4444'
                }}>
                  {riskPct <= 2 ? 'CONSERVATIVE' : riskPct <= 5 ? 'MODERATE' : riskPct <= 10 ? 'AGGRESSIVE' : 'EXTREME'}
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(riskPct * 4, 100)}%`,
                    background: `linear-gradient(90deg, ${riskPct <= 2 ? '#22c55e' : riskPct <= 5 ? '#eab308' : '#ef4444'}88, ${riskPct <= 2 ? '#22c55e' : riskPct <= 5 ? '#eab308' : '#ef4444'})`,
                    boxShadow: `0 0 8px ${riskPct <= 2 ? '#22c55e' : riskPct <= 5 ? '#eab308' : '#ef4444'}40`,
                  }}
                />
              </div>
            </div>
            {/* Balance usage */}
            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-gray-500 font-bold">Stop Loss as % of Balance</span>
                <span className="font-mono font-bold" style={{ color: stopLoss / accountBalance <= 0.05 ? '#22c55e' : stopLoss / accountBalance <= 0.2 ? '#eab308' : '#ef4444' }}>
                  {((stopLoss / accountBalance) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min((stopLoss / accountBalance) * 100, 100)}%`,
                    background: `linear-gradient(90deg, ${stopLoss / accountBalance <= 0.05 ? '#22c55e' : stopLoss / accountBalance <= 0.2 ? '#eab308' : '#ef4444'}88, ${stopLoss / accountBalance <= 0.05 ? '#22c55e' : stopLoss / accountBalance <= 0.2 ? '#eab308' : '#ef4444'})`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

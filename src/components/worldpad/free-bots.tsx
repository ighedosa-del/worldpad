'use client';

import { useState, useCallback } from 'react';
import { Zap, Sparkles, Pencil, Flame, CheckCircle2, Smile, Square } from 'lucide-react';
import { useWorldpadStore } from '@/lib/store';
import { useBotRunner } from '@/hooks/use-bot-runner';
import { isSimulating } from '@/lib/deriv-ws';

interface BotCard {
  id: string;
  title: string;
  description: string;
  type: 'auto' | 'normal' | 'automated';
  strategy: string;
}

const BOTS: BotCard[] = [
  { id: '1', title: 'Infinity Algo', description: 'Advanced digit prediction using infinite series analysis. Tracks patterns across 10,000+ ticks for high-probability signals.', type: 'automated', strategy: 'DIGITMATCH — Targets the least frequent digit from distribution data' },
  { id: '2', title: 'The Under 7 8 9 Switcher', description: 'Dynamically switches between Under 7, Under 8, and Under 9 based on real-time digit distribution shifts.', type: 'auto', strategy: 'DIGITUNDER — Switches barrier between 7, 8, 9 based on digit patterns' },
  { id: '3', title: 'Even Odd Master', description: 'Capitalizes on even/odd streaks with intelligent streak detection and reversal prediction.', type: 'auto', strategy: 'DIGITEVEN/DIGITODD — Bets on streak continuation or reversal' },
  { id: '4', title: 'Rise Fall Predictor', description: 'Uses tick direction momentum to predict rise/fall patterns with 5-tick lookahead analysis.', type: 'automated', strategy: 'DIGITOVER/DIGITUNDER — Bets on the dominant rise/fall direction' },
  { id: '5', title: 'Digit 0 Hunter', description: 'Specialized bot that exclusively targets digit 0 matches. Uses volatility timing for optimal entry.', type: 'normal', strategy: 'DIGITMATCH barrier 0 — Always targets digit 0' },
  { id: '6', title: 'Quick Scalper', description: 'Fast-paced 1-tick digit differs bot. Targets least frequent digits for maximum payout rates.', type: 'auto', strategy: 'DIGITDIFF — Targets the least frequent digit for high payout' },
  { id: '7', title: 'Martingale Pro', description: 'Smart martingale system with configurable multipliers and stop-loss protection. Built-in recovery algorithm.', type: 'automated', strategy: 'DIGITOVER barrier 5 — Martingale doubles stake on loss' },
  { id: '8', title: 'Over Under Hybrid', description: 'Combines over and under strategies with dynamic barrier selection based on current market conditions.', type: 'normal', strategy: 'DIGITOVER/DIGITUNDER — Uses analysisOverUnderDigit from store for barrier' },
];

const FILTERS = [
  { id: 'all', label: 'All', icon: Flame },
  { id: 'automated', label: 'Automated', icon: CheckCircle2 },
  { id: 'normal', label: 'Normal', icon: Smile },
];

export function FreeBots() {
  const [activeFilter, setActiveFilter] = useState('all');
  const [loginRequired, setLoginRequired] = useState<string | null>(null);
  const { activeBotId, setActiveBotId, setActiveBotStrategy, setActiveTab, addAutoTraderLog, isBotRunning } = useWorldpadStore();
  const { startBot, stopBot } = useBotRunner();
  const simMode = isSimulating();

  const handleRunBot = useCallback((bot: BotCard) => {
    setLoginRequired(null);

    if (activeBotId === bot.id && isBotRunning) {
      stopBot();
      setActiveBotId(null);
      setActiveBotStrategy(null);
      return;
    }

    if (isBotRunning) { stopBot(); }

    setActiveBotId(bot.id);
    setActiveBotStrategy(bot.strategy);
    addAutoTraderLog(`[BOT] Loading ${bot.title}...`);
    addAutoTraderLog(`[BOT] Strategy: ${bot.strategy}`);
    addAutoTraderLog(`[BOT] Mode: ${simMode ? 'SIMULATION' : 'LIVE'}`);

    setTimeout(() => { startBot(); }, 100);
    setActiveTab('auto-trader');
  }, [activeBotId, isBotRunning, setActiveBotId, setActiveBotStrategy, setActiveTab, addAutoTraderLog, startBot, stopBot, simMode]);

  const filteredBots = activeFilter === 'all' ? BOTS : BOTS.filter(b => b.type === activeFilter);

  return (
    <div className="h-[calc(100vh-52px)] flex flex-col overflow-hidden">
      {/* Filter Bar */}
      <div className="flex items-center gap-3 px-4 py-3" style={{ background: 'rgba(22,27,34,0.8)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${activeFilter === f.id ? 'text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-[rgba(255,255,255,0.03)]'}`}
              style={activeFilter === f.id ? { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' } : { border: '1px solid transparent' }}
            >
              <f.icon className="w-3.5 h-3.5" />
              {f.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {simMode && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold" style={{ background: 'rgba(139,92,246,0.1)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.2)' }}>SIM MODE</div>
          )}
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold text-purple-400 transition-all duration-200 hover:bg-[rgba(139,92,246,0.2)]" style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)', textShadow: '0 0 6px rgba(139,92,246,0.5)' }}>
            <Sparkles className="w-3 h-3" />
            AI
          </button>
          <button className="p-1.5 rounded-lg text-gray-500 hover:text-white transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Bot Cards */}
      <div className="flex-1 overflow-y-auto wp-scroll p-4 flex flex-col gap-3">
        {filteredBots.map((bot, i) => {
          const isActive = activeBotId === bot.id && isBotRunning;
          const showLogin = loginRequired === bot.id;
          return (
            <div key={bot.id} className="wp-gradient-border-gold rounded-xl p-4 flex items-start sm:items-center gap-4 flex-col sm:flex-row group transition-all duration-300 hover:translate-y-[-1px]" style={{ background: 'rgba(22,27,34,0.8)' }}>
              <div className="flex items-center gap-3 shrink-0">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-110" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(255,215,0,0.15))', border: '1px solid rgba(245,158,11,0.25)', boxShadow: '0 0 12px rgba(255,215,0,0.08)' }}>
                  <Zap className="w-5 h-5 text-yellow-400" style={{ filter: 'drop-shadow(0 0 4px rgba(250,204,21,0.5))' }} />
                </div>
                <span className="px-2 py-0.5 rounded text-[9px] font-black tracking-wider" style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.2)' }}>{bot.type.toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-white mb-1">{bot.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{bot.description}</p>
              </div>
              <button
                onClick={() => handleRunBot(bot)}
                className="shrink-0 flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-bold transition-all duration-200 hover:translate-y-[-1px]"
                style={isActive ? { background: 'linear-gradient(135deg, #dc2626, #ef4444)', color: '#fff', boxShadow: '0 0 16px rgba(220,38,38,0.4)' } : { background: 'linear-gradient(135deg, #f59e0b, #ffd700, #f59e0b)', color: '#0d1117', boxShadow: '0 0 16px rgba(255,215,0,0.3)' }}
              >
                {isActive ? <><Square className="w-3.5 h-3.5" /> Stop</> : <><Zap className="w-3.5 h-3.5" /> Run Bot</>}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

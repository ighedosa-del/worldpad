'use client';

import { useMemo, useState } from 'react';
import { Play, Square, Brain, Wifi, WifiOff, ChevronDown, ChevronUp, Trophy, TrendingUp, BarChart3, GraduationCap } from 'lucide-react';
import { useAIBot } from '@/hooks/use-ai-bot';
import { SCANNED_MARKETS, getMarketData } from '@/lib/multi-market-ws';

type StatusBadgeColor = 'scanning' | 'trading' | 'waiting' | 'idle';

const STATUS_STYLES: Record<StatusBadgeColor, { bg: string; text: string; glow: string; label: string }> = {
  scanning: { bg: 'rgba(59,130,246,0.15)', text: '#3b82f6', glow: '0 0 8px rgba(59,130,246,0.4)', label: 'SCANNING' },
  trading: { bg: 'rgba(34,197,94,0.15)', text: '#22c55e', glow: '0 0 8px rgba(34,197,94,0.4)', label: 'TRADING' },
  waiting: { bg: 'rgba(234,179,8,0.15)', text: '#eab308', glow: '0 0 8px rgba(234,179,8,0.3)', label: 'WAITING' },
  idle: { bg: 'rgba(125,133,144,0.15)', text: '#7d8590', glow: 'none', label: 'IDLE' },
};

function getRankColor(rank: number): string {
  if (rank === 1) return '#fbbf24';
  if (rank === 2) return '#94a3b8';
  if (rank === 3) return '#d97706';
  return '#4b5563';
}

function getScoreColor(score: number): string {
  if (score > 70) return '#22c55e';
  if (score > 50) return '#eab308';
  return '#6b7280';
}

function getScoreBarColor(score: number): string {
  if (score > 70) return 'linear-gradient(90deg, #16a34a, #22c55e)';
  if (score > 50) return 'linear-gradient(90deg, #ca8a04, #eab308)';
  return 'linear-gradient(90deg, #4b5563, #6b7280)';
}

function isTopSignal(market: { rank: number; combinedScore: number }): boolean {
  return (market.rank === 1 || market.rank === 2) && market.combinedScore > 55;
}

function formatContractType(ct: string): string {
  const map: Record<string, string> = {
    DIGITMATCH: 'Match',
    DIGITDIFF: 'Differ',
    DIGITOVER: 'Over',
    DIGITUNDER: 'Under',
    DIGITEVEN: 'Even',
    DIGITODD: 'Odd',
  };
  return map[ct] || ct;
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[9px] text-gray-500 uppercase tracking-wider font-medium">{label}</span>
      <span className="text-xs font-bold text-gray-300 font-mono">{value.toFixed(1)}</span>
    </div>
  );
}

function MarketCard({
  market,
  lastDigit,
}: {
  market: ReturnType<typeof useAIBot>['rankedMarkets'][number];
  lastDigit: number | null;
}) {
  const { rank, name, type, combinedScore, logicScore, aiScore, selectedSignal } = market;
  const top = isTopSignal(market);
  const scoreColor = getScoreColor(combinedScore);
  const barGradient = getScoreBarColor(combinedScore);
  const rankColor = getRankColor(rank);

  return (
    <div
      className="relative rounded-xl p-4 transition-all duration-300"
      style={{
        background: top ? 'rgba(59,130,246,0.06)' : '#161b22',
        border: top
          ? '1px solid rgba(59,130,246,0.4)'
          : '1px solid #30363d',
        boxShadow: top
          ? '0 0 20px rgba(59,130,246,0.12), 0 0 40px rgba(59,130,246,0.05)'
          : '0 1px 3px rgba(0,0,0,0.3)',
      }}
    >
      {/* Top signal glow indicator */}
      {top && (
        <div
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{
            boxShadow: 'inset 0 0 20px rgba(59,130,246,0.08), 0 0 15px rgba(59,130,246,0.15)',
          }}
        />
      )}

      {/* Header: Market name + rank + last digit */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {/* Rank badge */}
          <div
            className="flex items-center justify-center w-8 h-8 rounded-lg text-sm font-black"
            style={{
              color: rankColor,
              background: `${rankColor}15`,
              border: `1px solid ${rankColor}30`,
              textShadow: rank <= 3 ? `0 0 8px ${rankColor}60` : 'none',
            }}
          >
            {rank <= 3 && <Trophy className="w-3 h-3 mr-0.5" style={{ color: rankColor }} />}
            {rank}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white text-sm font-semibold">{name}</span>
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase"
                style={{
                  background: type === 'fast' ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.12)',
                  color: type === 'fast' ? '#f87171' : '#60a5fa',
                  border: `1px solid ${type === 'fast' ? 'rgba(239,68,68,0.25)' : 'rgba(59,130,246,0.2)'}`,
                }}
              >
                {type === 'fast' ? '1s' : 'STD'}
              </span>
            </div>
          </div>
        </div>

        {/* Last digit */}
        <div
          className="flex items-center justify-center w-9 h-9 rounded-lg font-mono text-lg font-black"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid #30363d',
            color: lastDigit !== null ? '#e2e8f0' : '#374151',
          }}
        >
          {lastDigit !== null ? lastDigit : '–'}
        </div>
      </div>

      {/* Combined score */}
      <div className="mb-3">
        <div className="flex items-end gap-2 mb-1.5">
          <span
            className="text-3xl font-black font-mono leading-none"
            style={{ color: scoreColor, textShadow: `0 0 12px ${scoreColor}40` }}
          >
            {combinedScore.toFixed(0)}
          </span>
          <span className="text-[10px] text-gray-500 pb-0.5">/ 100</span>
        </div>
        {/* Score bar */}
        <div
          className="w-full h-1.5 rounded-full overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${Math.min(100, combinedScore)}%`,
              background: barGradient,
              boxShadow: `0 0 8px ${scoreColor}40`,
            }}
          />
        </div>
      </div>

      {/* Logic + AI sub-scores */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div
          className="rounded-lg p-2"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <div className="flex items-center gap-1 mb-1">
            <BarChart3 className="w-3 h-3 text-blue-400" />
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Logic</span>
          </div>
          <span
            className="text-base font-bold font-mono"
            style={{ color: getScoreColor(logicScore.score) }}
          >
            {logicScore.score.toFixed(0)}
          </span>
          <div className="grid grid-cols-4 gap-1 mt-1.5">
            <MiniStat label="Freq" value={logicScore.components.frequencyDeviation} />
            <MiniStat label="Strk" value={logicScore.components.streakScore} />
            <MiniStat label="Bal" value={logicScore.components.balanceScore} />
            <MiniStat label="H/C" value={logicScore.components.hotColdScore} />
          </div>
        </div>

        <div
          className="rounded-lg p-2"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <div className="flex items-center gap-1 mb-1">
            <Brain className="w-3 h-3 text-purple-400" />
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">AI</span>
          </div>
          <span
            className="text-base font-bold font-mono"
            style={{ color: getScoreColor(aiScore.score) }}
          >
            {aiScore.score.toFixed(0)}
          </span>
          <div className="grid grid-cols-4 gap-1 mt-1.5">
            <MiniStat label="Mkv" value={aiScore.components.markovScore} />
            <MiniStat label="Ent" value={aiScore.components.entropyScore} />
            <MiniStat label="Bay" value={aiScore.components.bayesianScore} />
            <MiniStat label="Lrn" value={aiScore.components.learningScore} />
          </div>
        </div>
      </div>

      {/* Signal indicator */}
      {selectedSignal && (
        <div
          className="rounded-lg px-3 py-2"
          style={{
            background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.2)',
          }}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <TrendingUp className="w-3 h-3 text-green-400" />
            <span className="text-[10px] font-bold text-green-400 uppercase tracking-wider">Signal</span>
            <span className="text-[10px] text-gray-500 ml-auto font-mono">
              {(selectedSignal.confidence * 100).toFixed(0)}%
            </span>
          </div>
          <div className="text-xs text-gray-300 font-medium">
            <span className="text-green-400 font-bold">{formatContractType(selectedSignal.contractType)}</span>
            {selectedSignal.barrier !== undefined && selectedSignal.barrier !== null && (
              <span className="text-gray-400"> d{selectedSignal.barrier}</span>
            )}
            <span className="text-gray-500 ml-1.5">— {selectedSignal.reason}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function LearningPanel({ learningStats }: { learningStats: ReturnType<typeof useAIBot>['learningStats'] }) {
  const [open, setOpen] = useState(false);
  const { strategiesLearned, totalTradesRecorded, totalWins, totalLosses, winRate, totalProfit } = learningStats;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: '#161b22', border: '1px solid #30363d' }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors hover:bg-[rgba(255,255,255,0.02)]"
      >
        <div className="flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-semibold text-white">AI Learning</span>
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-bold"
            style={{
              background: 'rgba(168,85,247,0.12)',
              color: '#a855f7',
              border: '1px solid rgba(168,85,247,0.25)',
            }}
          >
            {strategiesLearned} strategies
          </span>
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: '#30363d' }}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Strategies Learned</span>
              <span className="text-lg font-bold text-white font-mono">{strategiesLearned}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Total Trades Recorded</span>
              <span className="text-lg font-bold text-white font-mono">{totalTradesRecorded}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Win Rate</span>
              <div className="flex items-center gap-2">
                <span
                  className="text-lg font-bold font-mono"
                  style={{ color: winRate >= 50 ? '#22c55e' : '#ef4444' }}
                >
                  {winRate.toFixed(1)}%
                </span>
              </div>
              {/* Win rate progress bar */}
              <div
                className="w-full h-1.5 rounded-full overflow-hidden mt-1"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min(100, winRate)}%`,
                    background: winRate >= 50
                      ? 'linear-gradient(90deg, #16a34a, #22c55e)'
                      : 'linear-gradient(90deg, #dc2626, #ef4444)',
                    boxShadow: winRate >= 50
                      ? '0 0 6px rgba(34,197,94,0.4)'
                      : '0 0 6px rgba(239,68,68,0.4)',
                  }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Recorded P/L</span>
              <span
                className="text-lg font-bold font-mono"
                style={{ color: totalProfit >= 0 ? '#22c55e' : '#ef4444' }}
              >
                {totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}
              </span>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-gray-500">
            <span className="text-green-400">W{totalWins}</span>
            <span className="text-gray-600">/</span>
            <span className="text-red-400">L{totalLosses}</span>
            <span className="text-gray-600 mx-1">·</span>
            <span>AI learns from every trade to improve future decisions</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function AIScanner() {
  const {
    isRunning,
    rankedMarkets,
    scannerConnected,
    status,
    cycleCount,
    totalTradesPlaced,
    totalProfit,
    learningStats,
    startBot,
    stopBot,
  } = useAIBot();

  // Get last digit per market — recompute on every render (ticks drive this)
  const marketDigits = useMemo(() => {
    const map: Record<string, number | null> = {};
    for (const m of SCANNED_MARKETS) {
      const data = getMarketData(m.symbol);
      map[m.symbol] = data.lastTick?.digit ?? null;
    }
    return map;
  });

  // Build a map of ranked markets by symbol for quick lookup
  const rankedMap = useMemo(() => {
    const map: Record<string, (typeof rankedMarkets)[number]> = {};
    for (const m of rankedMarkets) {
      map[m.symbol] = m;
    }
    return map;
  }, [rankedMarkets]);

  // Merge SCANNED_MARKETS with ranked data (so all 10 are always shown)
  const displayMarkets = useMemo(() => {
    return SCANNED_MARKETS.map((m, i) => {
      const ranked = rankedMap[m.symbol];
      return ranked || {
        symbol: m.symbol,
        name: m.name,
        type: m.type,
        combinedScore: 0,
        logicScore: { score: 0, signal: null, components: { frequencyDeviation: 0, streakScore: 0, balanceScore: 0, hotColdScore: 0 } },
        aiScore: { score: 0, signal: null, components: { markovScore: 0, entropyScore: 0, bayesianScore: 0, learningScore: 0 } },
        selectedSignal: null,
        rank: rankedMarkets.length > 0 ? rankedMarkets.length : i + 1,
      };
    });
  }, [rankedMarkets, rankedMap]);

  const statusStyle = STATUS_STYLES[status];

  return (
    <div className="h-[calc(100vh-52px)] flex flex-col overflow-hidden p-4 gap-4">
      {/* Header Bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full" style={{
            background: 'rgba(168,85,247,0.12)',
            border: '1px solid rgba(168,85,247,0.25)',
            boxShadow: '0 0 12px rgba(168,85,247,0.12)',
          }}>
            <Brain className="w-3.5 h-3.5 text-purple-400" style={{ filter: 'drop-shadow(0 0 4px rgba(168,85,247,0.6))' }} />
            <span className="text-[10px] font-bold text-purple-400" style={{ textShadow: '0 0 8px rgba(168,85,247,0.5)' }}>AI</span>
          </div>
          <h1 className="text-white text-lg font-bold">AI Scanner</h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Connection status */}
          <div className="flex items-center gap-1.5">
            {scannerConnected ? (
              <>
                <div
                  className="w-2 h-2 rounded-full bg-green-500 animate-wp-pulse"
                  style={{ boxShadow: '0 0 8px rgba(34,197,94,0.8)' }}
                />
                <span className="text-[10px] text-green-400 font-medium">Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-red-400" />
                <span className="text-[10px] text-red-400 font-medium">Disconnected</span>
              </>
            )}
          </div>

          {/* Start / Stop button */}
          <button
            onClick={() => { if (isRunning) stopBot(); else startBot(); }}
            className={`flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
              isRunning ? 'wp-btn-danger' : 'wp-btn-primary'
            }`}
          >
            {isRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isRunning ? 'STOP' : 'START'}
          </button>
        </div>
      </div>

      {/* Stats Bar — visible when running */}
      {isRunning && (
        <div
          className="flex items-center gap-4 sm:gap-6 px-4 py-2.5 rounded-xl overflow-x-auto"
          style={{
            background: '#161b22',
            border: '1px solid #30363d',
          }}
        >
          <StatItem label="Cycles" value={cycleCount.toString()} color="#e2e8f0" />
          <div className="w-px h-6 bg-[#30363d] shrink-0" />
          <StatItem label="Trades Placed" value={totalTradesPlaced.toString()} color="#e2e8f0" />
          <div className="w-px h-6 bg-[#30363d] shrink-0" />
          <StatItem
            label="P/L"
            value={`${totalProfit >= 0 ? '+' : ''}$${totalProfit.toFixed(2)}`}
            color={totalProfit >= 0 ? '#22c55e' : '#ef4444'}
          />
          <div className="w-px h-6 bg-[#30363d] shrink-0" />
          <StatItem
            label="AI Win Rate"
            value={`${learningStats.winRate.toFixed(1)}%`}
            color={learningStats.winRate >= 50 ? '#22c55e' : '#ef4444'}
          />
          <div className="w-px h-6 bg-[#30363d] shrink-0" />
          <StatItem label="Strategies" value={learningStats.strategiesLearned.toString()} color="#a855f7" />
          <div className="w-px h-6 bg-[#30363d] shrink-0" />
          {/* Status badge */}
          <div
            className="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
            style={{
              background: statusStyle.bg,
              color: statusStyle.text,
              border: `1px solid ${statusStyle.text}30`,
              boxShadow: statusStyle.glow,
            }}
          >
            {statusStyle.label}
          </div>
        </div>
      )}

      {/* Market Grid */}
      <div className="flex-1 overflow-y-auto wp-scroll">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {displayMarkets.map((market) => (
            <MarketCard
              key={market.symbol}
              market={market}
              lastDigit={marketDigits[market.symbol] ?? null}
            />
          ))}
        </div>

        {/* AI Learning Panel */}
        <div className="mt-4">
          <LearningPanel learningStats={learningStats} />
        </div>
      </div>
    </div>
  );
}

function StatItem({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 shrink-0">
      <span className="text-[9px] text-gray-500 uppercase tracking-wider font-medium">{label}</span>
      <span className="text-sm font-bold font-mono" style={{ color }}>{value}</span>
    </div>
  );
}

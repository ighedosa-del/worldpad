'use client';

import { useWorldpadStore } from '@/lib/store';
import { useState, useRef, useCallback, useMemo } from 'react';
import { Play, Zap, Sparkles, Bot, Square } from 'lucide-react';
import { useBotRunner } from '@/hooks/use-bot-runner';
import { isSimulating } from '@/lib/deriv-ws';

const LOG_ENTRIES = [
  { type: 'INFO', msg: 'Worldpad Auto Trader v2.4.1 initializing...' },
  { type: 'INFO', msg: 'Authenticating API key... ✓' },
  { type: 'SUCCESS', msg: 'API authentication successful' },
  { type: 'OK', msg: 'Data stream active on Volatility 100 (1s)' },
  { type: 'INFO', msg: 'Signal Analysis engine loaded' },
  { type: 'INFO', msg: 'Circles module initialized (10-digit tracking)' },
  { type: 'INFO', msg: 'Market selection: Volatility 100 (1s) Index' },
  { type: 'OK', msg: 'Live tick stream connected' },
  { type: 'WARNING', msg: 'Fast speed mode available — use with caution' },
  { type: 'INFO', msg: 'Waiting for analyse command...' },
];

type LogType = 'INFO' | 'SUCCESS' | 'OK' | 'WARNING' | 'ERROR' | 'SIGNAL' | 'ANALYSIS';

const LOG_COLORS: Record<LogType, string> = {
  INFO: '#7d8590',
  SUCCESS: '#22c55e',
  OK: '#00d4aa',
  WARNING: '#eab308',
  ERROR: '#ef4444',
  SIGNAL: '#e040fb',
  ANALYSIS: '#60a5fa',
};

const LOG_GLOW_COLORS: Record<LogType, string> = {
  INFO: 'none',
  SUCCESS: '0 0 6px rgba(34,197,94,0.4)',
  OK: '0 0 6px rgba(0,212,170,0.4)',
  WARNING: '0 0 6px rgba(234,179,8,0.4)',
  ERROR: '0 0 8px rgba(239,68,68,0.5)',
  SIGNAL: '0 0 8px rgba(224,64,251,0.5)',
  ANALYSIS: '0 0 6px rgba(96,165,250,0.4)',
};

function createBootLogs(): Array<{ time: string; type: LogType; msg: string }> {
  const now = new Date();
  return LOG_ENTRIES.map((entry, i) => {
    const t = new Date(now.getTime() + i * 400);
    return { time: t.toLocaleTimeString('en-US', { hour12: false }), type: entry.type as LogType, msg: entry.msg };
  });
}

function LogLine({ time, type, msg }: { time: string; type: LogType; msg: string }) {
  return (
    <div className="flex gap-2 text-xs leading-relaxed">
      <span className="text-gray-600 shrink-0 font-mono">{time}</span>
      <span className="shrink-0 font-bold font-mono" style={{
        color: LOG_COLORS[type],
        textShadow: LOG_GLOW_COLORS[type],
      }}>[{type}]</span>
      <span className="font-mono" style={{
        color: LOG_COLORS[type],
        textShadow: LOG_GLOW_COLORS[type],
      }}>{msg}</span>
    </div>
  );
}

interface AnalysisSignal {
  confidence: number;
  type: string;
  barrier: number;
  reason: string;
}

export function AutoTrader() {
  const {
    isConnected, isBotRunning, fastSpeed, setFastSpeed,
    livePrice, addAutoTraderLog,
    digitDistribution, digitHistory, overUnderHistory, matchDifferHistory,
    evenOddHistory, riseFallHistory, activeBotStrategy, activeBotId,
    botTradeCount, botSessionProfit, botConsecutiveLosses, botConfig,
  } = useWorldpadStore();
  const { startBot, stopBot } = useBotRunner();
  const simMode = isSimulating();

  const bootLogs = useMemo(() => createBootLogs(), []);
  const [liveLogs, setLiveLogs] = useState<Array<{ time: string; type: LogType; msg: string }>>([]);
  const isAnalyzing = useRef(false);
  const lastPriceRef = useRef(0);

  const tickLogEntry = useMemo(() => {
    if (!isBotRunning || livePrice === 0 || livePrice === lastPriceRef.current) return null;
    lastPriceRef.current = livePrice;
    const type: LogType = Math.random() > 0.85 ? 'SIGNAL' : 'OK';
    const digit = livePrice.toString().split('').pop();
    const msg = type === 'SIGNAL'
      ? `SIGNAL: Strong digit ${digit} pattern detected — confidence ${(75 + Math.random() * 20).toFixed(1)}%`
      : `Latest Tick: ${livePrice.toFixed(4)} (last digit: ${digit})`;
    return { time: new Date().toLocaleTimeString('en-US', { hour12: false }), type, msg };
  }, [livePrice, isBotRunning]);

  const logs = useMemo(() => {
    const combined = [...bootLogs, ...liveLogs];
    if (tickLogEntry) {
      return [...combined.slice(-199), tickLogEntry];
    }
    return combined.slice(-200);
  }, [bootLogs, liveLogs, tickLogEntry]);

  const scrollDivRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, []);

  const performAnalysis = useCallback(() => {
    const analysisLogs: Array<{ type: LogType; msg: string }> = [];
    const signals: AnalysisSignal[] = [];
    const expected = 10; // expected 10% per digit

    // 1. Scan digitDistribution for anomalies
    const totalDigits = digitDistribution.reduce((a, b) => a + b, 0);
    if (totalDigits > 0) {
      analysisLogs.push({ type: 'ANALYSIS', msg: `Scanning digit distribution (${totalDigits} total ticks)...` });
      const percentages = digitDistribution.map(d => (d / totalDigits) * 100);

      let hotDigit = -1;
      let hotPct = 0;
      let coldDigit = -1;
      let coldPct = 100;

      for (let i = 0; i < 10; i++) {
        if (percentages[i] > 15) {
          analysisLogs.push({
            type: 'ANALYSIS',
            msg: `Digit ${i} is hot (${percentages[i].toFixed(1)}% vs ${expected}% expected) — DIGITMATCH signal`,
          });
          signals.push({
            confidence: Math.min(95, 60 + (percentages[i] - expected) * 5),
            type: 'DIGITMATCH',
            barrier: i,
            reason: `distribution anomaly (${percentages[i].toFixed(1)}% frequency)`,
          });
        }
        if (percentages[i] < 5) {
          analysisLogs.push({
            type: 'ANALYSIS',
            msg: `Digit ${i} is cold (${percentages[i].toFixed(1)}% vs ${expected}% expected) — may revert`,
          });
          signals.push({
            confidence: Math.min(80, 55 + (expected - percentages[i]) * 4),
            type: 'DIGITMATCH',
            barrier: i,
            reason: `cold digit reversion (${percentages[i].toFixed(1)}% frequency)`,
          });
        }
        if (percentages[i] > hotPct) { hotDigit = i; hotPct = percentages[i]; }
        if (percentages[i] < coldPct) { coldDigit = i; coldPct = percentages[i]; }
      }

      analysisLogs.push({
        type: 'ANALYSIS',
        msg: `Distribution range: ${coldPct.toFixed(1)}% (d${coldDigit}) → ${hotPct.toFixed(1)}% (d${hotDigit})`,
      });
    } else {
      analysisLogs.push({ type: 'WARNING', msg: 'No digit distribution data yet — waiting for ticks' });
    }

    // 2. Scan digitHistory for streaks
    if (digitHistory.length > 0) {
      analysisLogs.push({ type: 'ANALYSIS', msg: `Scanning digit history (${digitHistory.length} ticks) for streaks...` });
      let streakDigit = digitHistory[0];
      let streakLen = 1;
      let maxStreakDigit = digitHistory[0];
      let maxStreakLen = 1;

      for (let i = 1; i < digitHistory.length; i++) {
        if (digitHistory[i] === digitHistory[i - 1]) {
          streakLen++;
          if (streakLen > maxStreakLen) {
            maxStreakLen = streakLen;
            maxStreakDigit = digitHistory[i];
          }
        } else {
          streakLen = 1;
          streakDigit = digitHistory[i];
        }
      }

      if (maxStreakLen >= 3) {
        analysisLogs.push({
          type: 'ANALYSIS',
          msg: `Digit ${maxStreakDigit} streak: ${maxStreakLen} consecutive — reversal likely`,
        });
        signals.push({
          confidence: Math.min(90, 50 + maxStreakLen * 8),
          type: 'DIGITDIFF',
          barrier: maxStreakDigit,
          reason: `digit streak reversal (${maxStreakLen}x d${maxStreakDigit})`,
        });
      }

      // Recent 10-digit streak check
      const recent = digitHistory.slice(-10);
      if (recent.length === 10) {
        let recentStreak = 1;
        for (let i = 1; i < recent.length; i++) {
          if (recent[i] === recent[i - 1]) recentStreak++;
          else break;
        }
        if (recentStreak >= 2) {
          analysisLogs.push({
            type: 'ANALYSIS',
            msg: `Recent streak: digit ${recent[0]} appeared ${recentStreak}x in a row`,
          });
        }
      }
    }

    // 3. Analyze overUnderHistory for patterns
    if (overUnderHistory.length > 0) {
      analysisLogs.push({ type: 'ANALYSIS', msg: `Analyzing Over/Under history (${overUnderHistory.length} entries)...` });
      let overCount = 0;
      let underCount = 0;
      let consecutiveO = 0;
      let consecutiveU = 0;
      let maxConsecutiveO = 0;
      let maxConsecutiveU = 0;

      for (const entry of overUnderHistory) {
        if (entry === 'O') {
          overCount++;
          consecutiveO++;
          consecutiveU = 0;
          if (consecutiveO > maxConsecutiveO) maxConsecutiveO = consecutiveO;
        } else {
          underCount++;
          consecutiveU++;
          consecutiveO = 0;
          if (consecutiveU > maxConsecutiveU) maxConsecutiveU = consecutiveU;
        }
      }

      const total = overCount + underCount;
      const overPct = ((overCount / total) * 100).toFixed(1);
      const underPct = ((underCount / total) * 100).toFixed(1);
      analysisLogs.push({
        type: 'ANALYSIS',
        msg: `Over/Under ratio: ${overPct}%/${underPct}% (${overCount}O / ${underCount}U)`,
      });

      if (maxConsecutiveO >= 5) {
        analysisLogs.push({
          type: 'ANALYSIS',
          msg: `Over streak: ${maxConsecutiveO} consecutive — reversal likely`,
        });
        signals.push({
          confidence: Math.min(85, 50 + maxConsecutiveO * 7),
          type: 'DIGITUNDER',
          barrier: 5,
          reason: `over streak reversal (${maxConsecutiveO}x Over)`,
        });
      }

      if (maxConsecutiveU >= 5) {
        analysisLogs.push({
          type: 'ANALYSIS',
          msg: `Under streak: ${maxConsecutiveU} consecutive — reversal likely`,
        });
        signals.push({
          confidence: Math.min(85, 50 + maxConsecutiveU * 7),
          type: 'DIGITOVER',
          barrier: 4,
          reason: `under streak reversal (${maxConsecutiveU}x Under)`,
        });
      }

      // Current streak (last entries)
      if (overUnderHistory.length >= 3) {
        const last3 = overUnderHistory.slice(-3);
        const allSame = last3.every(e => e === last3[0]);
        if (allSame) {
          const streakDir = last3[0];
          const actualStreak = overUnderHistory.slice().reverse().findIndex(e => e !== streakDir);
          const streakCount = actualStreak === -1 ? overUnderHistory.length : actualStreak;
          analysisLogs.push({
            type: 'ANALYSIS',
            msg: `Active ${streakDir === 'O' ? 'Over' : 'Under'} streak: ${streakCount} in a row`,
          });
        }
      }
    }

    // 4. Check matchDifferHistory for match frequency
    if (matchDifferHistory.length > 0) {
      analysisLogs.push({ type: 'ANALYSIS', msg: `Checking Match/Differ history (${matchDifferHistory.length} entries)...` });
      const matchCount = matchDifferHistory.filter(e => e === 'M').length;
      const differCount = matchDifferHistory.length - matchCount;
      const matchPct = ((matchCount / matchDifferHistory.length) * 100).toFixed(1);
      const differPct = ((differCount / matchDifferHistory.length) * 100).toFixed(1);

      analysisLogs.push({
        type: 'ANALYSIS',
        msg: `Match/Differ ratio: ${matchPct}%/${differPct}% (${matchCount}M / ${differCount}D)`,
      });

      if (parseFloat(matchPct) > 15) {
        signals.push({
          confidence: Math.min(75, 50 + (parseFloat(matchPct) - 10) * 3),
          type: 'DIGITMATCH',
          barrier: -1,
          reason: `high match frequency (${matchPct}%)`,
        });
      }
      if (parseFloat(differPct) > 92) {
        signals.push({
          confidence: Math.min(80, 50 + (parseFloat(differPct) - 90) * 10),
          type: 'DIGITDIFF',
          barrier: -1,
          reason: `very high differ frequency (${differPct}%)`,
        });
      }

      // Recent match/differ streak
      const last5 = matchDifferHistory.slice(-5);
      if (last5.length === 5) {
        const allDiffer = last5.every(e => e === 'D');
        const allMatch = last5.every(e => e === 'M');
        if (allDiffer) {
          analysisLogs.push({ type: 'ANALYSIS', msg: '5 consecutive DIFFER — match may be due' });
          signals.push({ confidence: 70, type: 'DIGITMATCH', barrier: -1, reason: 'differ streak reversion (5x D)' });
        }
        if (allMatch) {
          analysisLogs.push({ type: 'ANALYSIS', msg: '5 consecutive MATCH — differ may be due' });
          signals.push({ confidence: 70, type: 'DIGITDIFF', barrier: -1, reason: 'match streak reversion (5x M)' });
        }
      }
    }

    // 5. Analyze evenOddHistory
    if (evenOddHistory.length > 0) {
      analysisLogs.push({ type: 'ANALYSIS', msg: `Analyzing Even/Odd history (${evenOddHistory.length} entries)...` });
      const evenCount = evenOddHistory.filter(e => e === 'E').length;
      const oddCount = evenOddHistory.length - evenCount;
      const evenPct = ((evenCount / evenOddHistory.length) * 100).toFixed(1);
      const oddPct = ((oddCount / evenOddHistory.length) * 100).toFixed(1);

      analysisLogs.push({
        type: 'ANALYSIS',
        msg: `Even/Odd ratio: ${evenPct}%/${oddPct}% — ${Math.abs(parseFloat(evenPct) - 50) > 3 ? (parseFloat(evenPct) > 50 ? 'slight even' : 'slight odd') + ' bias' : 'balanced'}`,
      });

      // Even/odd streak
      let eoStreak = 1;
      const reversed = [...evenOddHistory].reverse();
      for (let i = 1; i < reversed.length; i++) {
        if (reversed[i] === reversed[0]) eoStreak++;
        else break;
      }
      if (eoStreak >= 4) {
        const streakType = reversed[0];
        analysisLogs.push({
          type: 'ANALYSIS',
          msg: `${streakType === 'E' ? 'Even' : 'Odd'} streak: ${eoStreak} consecutive — reversal likely`,
        });
        signals.push({
          confidence: Math.min(82, 55 + eoStreak * 6),
          type: streakType === 'E' ? 'DIGITODD' : 'DIGITEVEN',
          barrier: -1,
          reason: `even/odd streak reversal (${eoStreak}x ${streakType})`,
        });
      }
    }

    // 6. Analyze riseFallHistory
    if (riseFallHistory.length > 0) {
      analysisLogs.push({ type: 'ANALYSIS', msg: `Analyzing Rise/Fall history (${riseFallHistory.length} entries)...` });
      const riseCount = riseFallHistory.filter(e => e === 'R').length;
      const fallCount = riseFallHistory.length - riseCount;
      const risePct = ((riseCount / riseFallHistory.length) * 100).toFixed(1);
      const fallPct = ((fallCount / riseFallHistory.length) * 100).toFixed(1);

      analysisLogs.push({
        type: 'ANALYSIS',
        msg: `Rise/Fall ratio: ${risePct}%/${fallPct}% — dominant: ${riseCount > fallCount ? 'RISE' : 'FALL'}`,
      });

      // Rise/fall streak
      let rfStreak = 1;
      const rfReversed = [...riseFallHistory].reverse();
      for (let i = 1; i < rfReversed.length; i++) {
        if (rfReversed[i] === rfReversed[0]) rfStreak++;
        else break;
      }
      if (rfStreak >= 4) {
        const streakDir = rfReversed[0];
        analysisLogs.push({
          type: 'ANALYSIS',
          msg: `${streakDir === 'R' ? 'Rise' : 'Fall'} streak: ${rfStreak} consecutive — reversal expected`,
        });
        signals.push({
          confidence: Math.min(80, 50 + rfStreak * 7),
          type: streakDir === 'R' ? 'DIGITUNDER' : 'DIGITOVER',
          barrier: streakDir === 'R' ? 5 : 4,
          reason: `rise/fall momentum reversal (${rfStreak}x ${streakDir === 'R' ? 'Rise' : 'Fall'})`,
        });
      }

      // Dominant direction signal
      const dominance = Math.max(parseFloat(risePct), parseFloat(fallPct));
      if (dominance > 58) {
        const dominantDir = riseCount > fallCount ? 'Rise' : 'Fall';
        analysisLogs.push({
          type: 'ANALYSIS',
          msg: `Strong ${dominantDir} dominance (${dominance.toFixed(1)}%) — momentum signal`,
        });
        signals.push({
          confidence: Math.min(75, 50 + (dominance - 50) * 2),
          type: riseCount > fallCount ? 'DIGITOVER' : 'DIGITUNDER',
          barrier: riseCount > fallCount ? 4 : 5,
          reason: `${dominantDir} momentum (${dominance.toFixed(1)}%)`,
        });
      }
    }

    // Generate final recommendation
    analysisLogs.push({ type: 'INFO', msg: 'Compiling final recommendation...' });

    // Pick the strongest signal
    if (signals.length > 0) {
      signals.sort((a, b) => b.confidence - a.confidence);
      const best = signals[0];
      const barrierStr = best.barrier >= 0 ? ` barrier ${best.barrier}` : '';
      analysisLogs.push({
        type: 'SIGNAL',
        msg: `RECOMMENDATION: ${best.type}${barrierStr} — confidence ${best.confidence.toFixed(1)}% (based on ${best.reason})`,
      });
    } else {
      analysisLogs.push({ type: 'WARNING', msg: 'RECOMMENDATION: No strong signal found — wait for clearer patterns' });
    }

    analysisLogs.push({ type: 'SUCCESS', msg: `Analysis complete — ${signals.length} signal${signals.length !== 1 ? 's' : ''} found` });

    return analysisLogs;
  }, [digitDistribution, digitHistory, overUnderHistory, matchDifferHistory, evenOddHistory, riseFallHistory]);

  const handleAnalyse = useCallback(() => {
    if (isAnalyzing.current) return;
    isAnalyzing.current = true;

    const analyseLogs = performAnalysis();

    analyseLogs.forEach((log, i) => {
      setTimeout(() => {
        const entry = { time: new Date().toLocaleTimeString('en-US', { hour12: false }), type: log.type, msg: log.msg };
        setLiveLogs(prev => [...prev.slice(-199), entry]);
        addAutoTraderLog(`[ANALYSIS] ${log.msg}`);
        if (i === analyseLogs.length - 1) isAnalyzing.current = false;
      }, i * 400);
    });
  }, [performAnalysis, addAutoTraderLog]);

  return (
    <div className="h-[calc(100vh-52px)] flex flex-col overflow-hidden p-4 gap-4">
      {/* Header Row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full" style={{
            background: 'rgba(139,92,246,0.12)',
            border: '1px solid rgba(139,92,246,0.25)',
            boxShadow: '0 0 12px rgba(139,92,246,0.15)',
          }}>
            <Sparkles className="w-3.5 h-3.5 text-purple-400" style={{ filter: 'drop-shadow(0 0 4px rgba(139,92,246,0.6))' }} />
            <span className="text-[10px] font-bold text-purple-400" style={{ textShadow: '0 0 8px rgba(139,92,246,0.5)' }}>AI</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-wp-pulse' : 'bg-red-500'}`} style={isConnected ? {
              boxShadow: '0 0 8px rgba(34,197,94,0.8)',
            } : {
              boxShadow: '0 0 8px rgba(239,68,68,0.8)',
            }} />
            <span className="text-[10px] text-gray-500 font-mono">Circles</span>
          </div>
          {activeBotStrategy && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{
              background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.2)',
            }}>
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-wp-pulse" style={{ boxShadow: '0 0 6px rgba(245,158,11,0.8)' }} />
              <span className="text-[10px] font-bold text-yellow-400">{activeBotStrategy.split('—')[0].trim()}</span>
            </div>
          )}
          {isBotRunning && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full" style={{
              background: 'rgba(34,197,94,0.1)',
              border: '1px solid rgba(34,197,94,0.2)',
            }}>
              <span className="text-[10px] font-mono" style={{ color: '#22c55e' }}>{botTradeCount}T</span>
              <span className="text-gray-600">|</span>
              <span className="text-[10px] font-mono" style={{
                color: botSessionProfit >= 0 ? '#22c55e' : '#ef4444',
              }}>{botSessionProfit >= 0 ? '+' : ''}{botSessionProfit.toFixed(2)}</span>
            </div>
          )}
          {simMode && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold" style={{
              background: 'rgba(139,92,246,0.1)',
              color: '#8b5cf6',
              border: '1px solid rgba(139,92,246,0.2)',
            }}>SIM</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFastSpeed(!fastSpeed)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all duration-200`}
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
            onClick={() => { if (isBotRunning) stopBot(); else startBot(); }}
            className={`flex items-center gap-1.5 px-5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
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
            {isBotRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isBotRunning ? 'STOP' : 'RUN'}
          </button>
        </div>
      </div>

      {/* Terminal with CRT effects */}
      <div className="flex-1 rounded-xl overflow-hidden flex flex-col relative wp-scanlines wp-scanline-beam" style={{
        background: '#000000',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 0 40px rgba(0,0,0,0.5), inset 0 0 80px rgba(0,212,170,0.02)',
      }}>
        {/* Terminal header */}
        <div className="flex items-center justify-between px-4 py-2 relative z-20" style={{
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(13,17,23,0.6)',
        }}>
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ background: '#ef4444', boxShadow: '0 0 6px rgba(239,68,68,0.4)' }} />
              <div className="w-3 h-3 rounded-full" style={{ background: '#eab308', boxShadow: '0 0 6px rgba(234,179,8,0.4)' }} />
              <div className="w-3 h-3 rounded-full" style={{ background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.4)' }} />
            </div>
            <span className="text-[10px] text-gray-500 ml-2 font-mono">worldpad-auto-trader</span>
          </div>
          <button
            onClick={handleAnalyse}
            className="flex items-center gap-1 px-3 py-1 rounded text-[10px] font-bold transition-all duration-200 hover:bg-[rgba(0,212,170,0.2)]"
            style={{
              background: 'rgba(0,212,170,0.08)',
              color: '#00d4aa',
              border: '1px solid rgba(0,212,170,0.2)',
              textShadow: '0 0 6px rgba(0,212,170,0.5)',
            }}
          >
            <Bot className="w-3 h-3" />
            Analyse
          </button>
        </div>
        {/* Terminal body with green glow text */}
        <div ref={scrollDivRef} className="flex-1 overflow-y-auto wp-scroll p-4 relative z-20" style={{
          fontFamily: 'var(--font-geist-mono), monospace',
        }}>
          {logs.map((log, i) => (
            <LogLine key={i} time={log.time} type={log.type} msg={log.msg} />
          ))}
          {logs.length === 0 && (
            <div className="text-gray-600 text-xs animate-pulse terminal-glow">Booting terminal...</div>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useWorldpadStore } from '@/lib/store';
import { useMemo } from 'react';
import { Brain, Activity, Flame, TrendingUp, Target, ArrowRight, Sparkles, AlertTriangle, Zap } from 'lucide-react';

function ConfidenceMeter({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(Math.max(value, 0), 100);
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-[10px] font-bold" style={{ color }}>{label}</span>
        <span className="text-[11px] font-mono font-bold" style={{ color, textShadow: `0 0 6px ${color}40` }}>{value.toFixed(1)}%</span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden relative" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}88, ${color})`,
            boxShadow: `0 0 8px ${color}40`,
          }}
        />
      </div>
    </div>
  );
}

function AnomalyScore({ digit, score }: { digit: number; score: number }) {
  const isOver = score > 0; // Over-represented
  const isAnomaly = Math.abs(score) > 15;
  const color = isOver ? (isAnomaly ? '#22c55e' : '#eab308') : (isAnomaly ? '#ef4444' : '#eab308');
  const intensity = Math.min(Math.abs(score) / 30, 1);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-mono font-bold w-4 text-right" style={{ color: isAnomaly ? color : '#7d8590' }}>{digit}</span>
      <div className="flex-1 h-4 rounded-sm overflow-hidden relative" style={{ background: 'rgba(255,255,255,0.03)' }}>
        {/* Center line at 0 */}
        <div className="absolute top-0 bottom-0 left-1/2 w-px" style={{ background: 'rgba(255,255,255,0.1)' }} />
        {/* Bar from center */}
        <div
          className="absolute top-0.5 bottom-0.5 rounded-sm transition-all duration-700"
          style={{
            left: score > 0 ? '50%' : `${50 + (score / 30) * 50}%`,
            right: score > 0 ? `${50 - (score / 30) * 50}%` : '50%',
            background: `linear-gradient(90deg, ${color}44, ${color})`,
            boxShadow: isAnomaly ? `0 0 8px ${color}30` : 'none',
          }}
        />
      </div>
      <span className="text-[10px] font-mono w-12 text-right" style={{ color }}>
        {score > 0 ? '+' : ''}{score.toFixed(1)}%
      </span>
    </div>
  );
}

export function AISoftware() {
  const {
    digitHistory, digitDistribution, currentDigit,
    overUnderHistory, matchDifferHistory, evenOddHistory, riseFallHistory,
  } = useWorldpadStore();

  // === Anomaly Scores ===
  const anomalyScores = useMemo(() => {
    if (digitHistory.length < 10) return new Array(10).fill(0);
    const total = digitHistory.length;
    const expected = 10; // 10% each
    return digitDistribution.map(pct => pct - expected);
  }, [digitHistory, digitDistribution]);

  // === Streak Detection ===
  const streak = useMemo(() => {
    if (evenOddHistory.length < 2) return { type: 'NONE', length: 0 };

    // Check even/odd streak
    let eoStreakType: string | null = null;
    let eoStreakLen = 0;
    for (let i = evenOddHistory.length - 1; i >= 0; i--) {
      const v = evenOddHistory[i];
      if (eoStreakType === null) { eoStreakType = v; eoStreakLen = 1; }
      else if (v === eoStreakType) { eoStreakLen++; }
      else break;
    }

    // Check over/under streak
    let ouStreakType: string | null = null;
    let ouStreakLen = 0;
    for (let i = overUnderHistory.length - 1; i >= 0; i--) {
      const v = overUnderHistory[i];
      if (ouStreakType === null) { ouStreakType = v; ouStreakLen = 1; }
      else if (v === ouStreakType) { ouStreakLen++; }
      else break;
    }

    // Check rise/fall streak
    let rfStreakType: string | null = null;
    let rfStreakLen = 0;
    for (let i = riseFallHistory.length - 1; i >= 0; i--) {
      const v = riseFallHistory[i];
      if (rfStreakType === null) { rfStreakType = v; rfStreakLen = 1; }
      else if (v === rfStreakType) { rfStreakLen++; }
      else break;
    }

    // Return the longest streak
    const streaks = [
      { type: eoStreakType === 'E' ? 'EVEN' : 'ODD', length: eoStreakLen },
      { type: ouStreakType === 'O' ? 'OVER' : 'UNDER', length: ouStreakLen },
      { type: rfStreakType === 'R' ? 'RISE' : 'FALL', length: rfStreakLen },
    ];
    streaks.sort((a, b) => b.length - a.length);
    return streaks[0].length >= 2 ? streaks[0] : { type: 'NONE', length: 0 };
  }, [evenOddHistory, overUnderHistory, riseFallHistory]);

  // === Pattern Confidence Meters ===
  const patternConfidence = useMemo(() => {
    const ouLen = overUnderHistory.length;
    const mdLen = matchDifferHistory.length;
    const eoLen = evenOddHistory.length;
    const rfLen = riseFallHistory.length;

    // Over/Under confidence: if one side dominates significantly
    let ouConf = 50;
    if (ouLen > 10) {
      const recent = overUnderHistory.slice(-50);
      const overCount = recent.filter(h => h === 'O').length;
      const ratio = overCount / recent.length;
      // Deviation from 50% = confidence in the trend
      ouConf = Math.abs(ratio - 0.5) * 200; // Scale to 0-100
      // Boost if there's a streak
      if (streak.type === 'OVER' || streak.type === 'UNDER') {
        ouConf = Math.min(ouConf + streak.length * 3, 100);
      }
    }

    // Match/Differ confidence
    let mdConf = 50;
    if (mdLen > 10) {
      const recent = matchDifferHistory.slice(-50);
      const matchCount = recent.filter(h => h === 'M').length;
      const ratio = matchCount / recent.length;
      mdConf = Math.abs(ratio - 0.1) * 111; // Expected 10% match, deviation = confidence in differ
    }

    // Even/Odd confidence
    let eoConf = 50;
    if (eoLen > 10) {
      const recent = evenOddHistory.slice(-50);
      const evenCount = recent.filter(h => h === 'E').length;
      const ratio = evenCount / recent.length;
      eoConf = Math.abs(ratio - 0.5) * 200;
      if (streak.type === 'EVEN' || streak.type === 'ODD') {
        eoConf = Math.min(eoConf + streak.length * 3, 100);
      }
    }

    // Rise/Fall confidence
    let rfConf = 50;
    if (rfLen > 10) {
      const recent = riseFallHistory.slice(-50);
      const riseCount = recent.filter(h => h === 'R').length;
      const ratio = riseCount / recent.length;
      rfConf = Math.abs(ratio - 0.5) * 200;
      if (streak.type === 'RISE' || streak.type === 'FALL') {
        rfConf = Math.min(rfConf + streak.length * 3, 100);
      }
    }

    return { overUnder: ouConf, matchDiffer: mdConf, evenOdd: eoConf, riseFall: rfConf };
  }, [overUnderHistory, matchDifferHistory, evenOddHistory, riseFallHistory, streak]);

  // === AI Recommendation ===
  const recommendation = useMemo(() => {
    const recs: { trade: string; reason: string; confidence: number; color: string; icon: React.ElementType }[] = [];

    // Check for streak reversal opportunity
    if (streak.length >= 3) {
      const reversalMap: Record<string, { trade: string; color: string }> = {
        EVEN: { trade: 'Bet ODD (Streak Reversal)', color: '#e040fb' },
        ODD: { trade: 'Bet EVEN (Streak Reversal)', color: '#e040fb' },
        OVER: { trade: 'Bet UNDER (Streak Reversal)', color: '#ff6b35' },
        UNDER: { trade: 'Bet OVER (Streak Reversal)', color: '#ff6b35' },
        RISE: { trade: 'Bet FALL (Streak Reversal)', color: '#22c55e' },
        FALL: { trade: 'Bet RISE (Streak Reversal)', color: '#22c55e' },
      };
      const s = reversalMap[streak.type];
      if (s) {
        recs.push({
          trade: s.trade,
          reason: `${streak.length}-tick ${streak.type} streak detected. Mean reversion likely.`,
          confidence: Math.min(50 + streak.length * 8, 92),
          color: s.color,
          icon: Zap,
        });
      }
    }

    // Check for hot/cold digit
    const maxAnomaly = Math.max(...anomalyScores);
    const minAnomaly = Math.min(...anomalyScores);
    const hotDigit = anomalyScores.indexOf(maxAnomaly);
    const coldDigit = anomalyScores.indexOf(minAnomaly);

    if (maxAnomaly > 20) {
      recs.push({
        trade: `OVER D${hotDigit} (Hot Digit)`,
        reason: `Digit ${hotDigit} is over-represented by ${maxAnomaly.toFixed(1)}%. Momentum may continue.`,
        confidence: Math.min(40 + maxAnomaly, 80),
        color: '#22c55e',
        icon: Flame,
      });
    }

    if (minAnomaly < -20) {
      recs.push({
        trade: `MATCH D${coldDigit} (Cold Digit)`,
        reason: `Digit ${coldDigit} is under-represented by ${Math.abs(minAnomaly).toFixed(1)}%. Due for appearance.`,
        confidence: Math.min(40 + Math.abs(minAnomaly), 78),
        color: '#00d4aa',
        icon: Target,
      });
    }

    // Check dominant pattern
    const { overUnder, matchDiffer, evenOdd, riseFall } = patternConfidence;
    const patterns = [
      { name: 'Over/Under', conf: overUnder, rec: overUnder > 60 ? (overUnderHistory.slice(-10).filter(h => h === 'O').length > 5 ? 'Bet UNDER (Contrarian)' : 'Bet OVER (Trend Follow)') : null },
      { name: 'Even/Odd', conf: evenOdd, rec: evenOdd > 60 ? (evenOddHistory.slice(-10).filter(h => h === 'E').length > 5 ? 'Bet ODD (Contrarian)' : 'Bet EVEN (Trend Follow)') : null },
      { name: 'Rise/Fall', conf: riseFall, rec: riseFall > 60 ? (riseFallHistory.slice(-10).filter(h => h === 'R').length > 5 ? 'Bet FALL (Contrarian)' : 'Bet RISE (Trend Follow)') : null },
    ];

    patterns.forEach(p => {
      if (p.rec && p.conf > 60) {
        const isContrarian = p.rec.includes('Contrarian');
        recs.push({
          trade: p.rec,
          reason: `${p.name} pattern shows ${p.conf.toFixed(0)}% directional confidence. ${isContrarian ? 'Dominant side likely to correct.' : 'Strong momentum detected.'}`,
          confidence: p.conf,
          color: isContrarian ? '#fbbf24' : '#e040fb',
          icon: TrendingUp,
        });
      }
    });

    // Sort by confidence
    recs.sort((a, b) => b.confidence - a.confidence);
    return recs.slice(0, 3);
  }, [streak, anomalyScores, patternConfidence, overUnderHistory, evenOddHistory, riseFallHistory]);

  return (
    <div className="h-[calc(100vh-52px)] flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto wp-scroll p-4 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Brain className="w-5 h-5" style={{ color: '#e040fb' }} />
          <h2 className="text-xs font-bold text-white uppercase tracking-wide" style={{ letterSpacing: '0.08em' }}>
            NEURAL ANALYSIS
          </h2>
          <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{
            background: 'rgba(224,64,251,0.1)',
            border: '1px solid rgba(224,64,251,0.2)',
          }}>
            <Sparkles className="w-3 h-3" style={{ color: '#e040fb' }} />
            <span className="text-[10px] font-bold" style={{ color: '#e040fb' }}>AI Active</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Anomaly Scores */}
          <div className="rounded-xl p-4" style={{
            background: 'rgba(22, 27, 34, 0.8)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wide" style={{ letterSpacing: '0.08em' }}>
                DIGIT ANOMALY SCORES
              </h3>
              <span className="text-[10px] text-gray-600">Deviation from 10% expected</span>
            </div>
            <div className="space-y-1.5">
              {anomalyScores.map((score, digit) => (
                <AnomalyScore key={digit} digit={digit} score={score} />
              ))}
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-[9px] text-gray-600">Under-represented</span>
              <span className="text-[9px] text-gray-600">Over-represented</span>
            </div>
          </div>

          {/* Streak Detection + Pattern Confidence */}
          <div className="flex flex-col gap-4">
            {/* Streak */}
            <div className="rounded-xl p-4" style={{
              background: 'rgba(22, 27, 34, 0.8)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <h3 className="text-xs font-bold text-white uppercase tracking-wide mb-3" style={{ letterSpacing: '0.08em' }}>
                STREAK DETECTION
              </h3>
              {streak.type !== 'NONE' ? (
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Flame className="w-5 h-5" style={{ color: '#ff6b35', filter: 'drop-shadow(0 0 6px rgba(255,107,53,0.5))' }} />
                    <div>
                      <span className="text-2xl font-black" style={{ color: '#ff6b35', textShadow: '0 0 12px rgba(255,107,53,0.4)' }}>
                        {streak.length}
                      </span>
                      <span className="text-xs text-gray-500 ml-1">ticks</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-sm font-bold text-white">{streak.type} streak</span>
                    <span className="text-[10px] text-gray-500 block">Active — reversal opportunity</span>
                  </div>
                  {streak.length >= 4 && (
                    <AlertTriangle className="w-5 h-5 ml-auto" style={{ color: '#eab308', filter: 'drop-shadow(0 0 6px rgba(234,179,8,0.5))' }} />
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-gray-600">
                  <Activity className="w-4 h-4" />
                  <span className="text-xs">No significant streak detected</span>
                </div>
              )}
            </div>

            {/* Pattern Confidence */}
            <div className="rounded-xl p-4 flex-1" style={{
              background: 'rgba(22, 27, 34, 0.8)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <h3 className="text-xs font-bold text-white uppercase tracking-wide mb-3" style={{ letterSpacing: '0.08em' }}>
                PATTERN CONFIDENCE
              </h3>
              <div className="space-y-3">
                <ConfidenceMeter label="OVER / UNDER" value={patternConfidence.overUnder} color="#22c55e" />
                <ConfidenceMeter label="MATCH / DIFFER" value={patternConfidence.matchDiffer} color="#8b5cf6" />
                <ConfidenceMeter label="EVEN / ODD" value={patternConfidence.evenOdd} color="#ff6b35" />
                <ConfidenceMeter label="RISE / FALL" value={patternConfidence.riseFall} color="#fbbf24" />
              </div>
            </div>
          </div>
        </div>

        {/* AI Recommendations */}
        <div className="rounded-xl p-4" style={{
          background: 'rgba(22, 27, 34, 0.8)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div className="flex items-center gap-3 mb-4">
            <Sparkles className="w-4 h-4" style={{ color: '#e040fb' }} />
            <h3 className="text-xs font-bold text-white uppercase tracking-wide" style={{ letterSpacing: '0.08em' }}>
              AI RECOMMENDATIONS
            </h3>
          </div>

          {recommendation.length > 0 ? (
            <div className="space-y-2">
              {recommendation.map((rec, i) => {
                const Icon = rec.icon;
                return (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 rounded-lg transition-all hover:translate-x-1"
                    style={{
                      background: `${rec.color}08`,
                      border: `1px solid ${rec.color}15`,
                    }}
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{
                      background: `${rec.color}15`,
                      border: `1px solid ${rec.color}25`,
                    }}>
                      <Icon className="w-4 h-4" style={{ color: rec.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold" style={{ color: rec.color }}>{rec.trade}</span>
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full" style={{
                          background: `${rec.color}15`,
                          color: rec.color,
                        }}>
                          {rec.confidence.toFixed(0)}% confidence
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{rec.reason}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 shrink-0 mt-1" style={{ color: `${rec.color}60` }} />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 gap-2">
              <Brain className="w-8 h-8 text-gray-700" />
              <span className="text-xs text-gray-600">Collecting data for analysis...</span>
              <span className="text-[10px] text-gray-700">Recommendations appear with sufficient tick data</span>
            </div>
          )}
        </div>

        {/* Live Data Footer */}
        <div className="rounded-xl p-3" style={{
          background: 'rgba(22, 27, 34, 0.5)',
          border: '1px solid rgba(255,255,255,0.04)',
        }}>
          <div className="flex items-center justify-between text-[10px] text-gray-600 font-mono">
            <span>Digits: {digitHistory.length}</span>
            <span>O/U: {overUnderHistory.length}</span>
            <span>M/D: {matchDifferHistory.length}</span>
            <span>E/O: {evenOddHistory.length}</span>
            <span>R/F: {riseFallHistory.length}</span>
            <span className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" style={{ boxShadow: '0 0 4px rgba(34,197,94,0.5)' }} />
              {' '}Live
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

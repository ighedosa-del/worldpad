'use client';

import { useWorldpadStore } from '@/lib/store';
import { useMemo } from 'react';
import { BarChart3, Activity } from 'lucide-react';

function getBarColor(count: number, maxCount: number, isCurrent: boolean) {
  if (isCurrent) return '#00d4aa';
  const ratio = maxCount > 0 ? count / maxCount : 0;
  if (ratio >= 0.75) return '#22c55e';
  if (ratio >= 0.45) return '#eab308';
  return '#ef4444';
}

export function Charts() {
  const { digitHistory, currentDigit, overUnderHistory, digitDistribution } = useWorldpadStore();

  // Histogram from last 100 digits
  const histogram = useMemo(() => {
    const last100 = digitHistory.slice(-100);
    const counts = new Array(10).fill(0);
    last100.forEach(d => { counts[d]++; });
    return counts;
  }, [digitHistory]);

  const maxCount = Math.max(...histogram, 1);

  // Timeline strip: last 50 digits
  const timeline = useMemo(() => {
    return digitHistory.slice(-50);
  }, [digitHistory]);

  // Over/Under ratio for donut
  const ouRatio = useMemo(() => {
    const over = overUnderHistory.filter(h => h === 'O').length;
    const under = overUnderHistory.filter(h => h === 'U').length;
    const total = over + under || 1;
    return { over: (over / total) * 100, under: (under / total) * 100, over, under, total };
  }, [overUnderHistory]);

  // CSS conic-gradient for donut
  const donutGradient = useMemo(() => {
    const overDeg = ouRatio.over;
    return `conic-gradient(
      #22c55e 0deg ${overDeg * 3.6}deg,
      #ef4444 ${overDeg * 3.6}deg 360deg
    )`;
  }, [ouRatio.over]);

  const digitDistMax = Math.max(...digitDistribution, 1);

  return (
    <div className="h-[calc(100vh-52px)] flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto wp-scroll p-4 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5" style={{ color: '#00d4aa' }} />
          <h2 className="text-xs font-bold text-white uppercase tracking-wide" style={{ letterSpacing: '0.08em' }}>
            DIGIT FREQUENCY CHART
          </h2>
          <span className="text-[10px] text-gray-500 ml-auto font-mono">
            Last {Math.min(digitHistory.length, 100)} digits
          </span>
        </div>

        {/* Bar Chart Panel */}
        <div className="rounded-xl p-4" style={{
          background: 'rgba(22, 27, 34, 0.8)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <h3 className="text-xs font-bold text-white uppercase tracking-wide mb-4" style={{ letterSpacing: '0.08em' }}>
            FREQUENCY HISTOGRAM
          </h3>
          <div className="flex items-end gap-1 sm:gap-2 h-48 px-1">
            {histogram.map((count, digit) => {
              const isCurrent = digit === currentDigit;
              const color = getBarColor(count, maxCount, isCurrent);
              const heightPct = maxCount > 0 ? (count / maxCount) * 100 : 0;
              return (
                <div key={digit} className="flex-1 flex flex-col items-center gap-1">
                  {/* Count label */}
                  <span className="text-[10px] font-mono font-bold" style={{ color }}>{count}</span>
                  {/* Bar */}
                  <div className="w-full relative rounded-t-sm overflow-hidden" style={{ height: '140px', background: 'rgba(255,255,255,0.02)' }}>
                    <div
                      className="absolute bottom-0 left-0 right-0 rounded-t-sm transition-all duration-500"
                      style={{
                        height: `${heightPct}%`,
                        background: isCurrent
                          ? `linear-gradient(180deg, ${color}cc, ${color}88)`
                          : `linear-gradient(180deg, ${color}99, ${color}44)`,
                        boxShadow: isCurrent ? `0 0 12px ${color}60` : `0 0 4px ${color}20`,
                        minHeight: count > 0 ? '4px' : '0px',
                      }}
                    />
                    {isCurrent && (
                      <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full" style={{
                        background: color,
                        boxShadow: `0 0 6px ${color}`,
                      }} />
                    )}
                  </div>
                  {/* Digit label */}
                  <span className={`text-xs font-bold ${isCurrent ? 'text-white' : 'text-gray-500'}`} style={isCurrent ? {
                    color,
                    textShadow: `0 0 8px ${color}80`,
                  } : {}}>
                    {digit}
                  </span>
                </div>
              );
            })}
          </div>
          {/* Legend */}
          <div className="flex items-center justify-center gap-4 mt-4">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: '#22c55e' }} />
              <span className="text-[10px] text-gray-500">High (≥75%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: '#eab308' }} />
              <span className="text-[10px] text-gray-500">Mid (≥45%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: '#ef4444' }} />
              <span className="text-[10px] text-gray-500">Low (&lt;45%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: '#00d4aa' }} />
              <span className="text-[10px] text-gray-500">Current</span>
            </div>
          </div>
        </div>

        {/* Bottom row: Timeline + Donut */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Digit Timeline Strip */}
          <div className="lg:col-span-2 rounded-xl p-4" style={{
            background: 'rgba(22, 27, 34, 0.8)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wide" style={{ letterSpacing: '0.08em' }}>
                DIGIT TIMELINE
              </h3>
              <div className="flex items-center gap-1.5">
                <Activity className="w-3 h-3" style={{ color: '#e040fb' }} />
                <span className="text-[10px] text-gray-500">Last 50</span>
              </div>
            </div>
            <div className="flex gap-1 flex-wrap">
              {timeline.length > 0 ? timeline.map((d, i) => {
                const isEven = d % 2 === 0;
                const isOver = d >= 5;
                let bg: string;
                if (d === currentDigit && i === timeline.length - 1) {
                  bg = '#00d4aa';
                } else {
                  bg = isOver ? 'rgba(34, 197, 94, 0.35)' : 'rgba(239, 68, 68, 0.35)';
                }
                const isLast = i === timeline.length - 1;
                return (
                  <div
                    key={i}
                    className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300 ${
                      isLast ? 'scale-110' : 'hover:scale-105'
                    }`}
                    style={{
                      background: bg,
                      color: (d === currentDigit && isLast) ? '#0d1117' : (isOver ? '#22c55e' : '#ef4444'),
                      border: isLast ? '1.5px solid #00d4aa' : '1px solid rgba(255,255,255,0.06)',
                      boxShadow: isLast ? '0 0 8px rgba(0,212,170,0.5)' : 'none',
                    }}
                  >
                    {d}
                  </div>
                );
              }) : (
                <span className="text-[10px] text-gray-600 animate-pulse">Waiting for digit data...</span>
              )}
            </div>
          </div>

          {/* Over/Under Donut */}
          <div className="rounded-xl p-4 flex flex-col items-center justify-center" style={{
            background: 'rgba(22, 27, 34, 0.8)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <h3 className="text-xs font-bold text-white uppercase tracking-wide mb-4 self-start" style={{ letterSpacing: '0.08em' }}>
              OVER / UNDER RATIO
            </h3>
            <div className="relative w-28 h-28">
              {/* Donut ring */}
              <div
                className="w-full h-full rounded-full"
                style={{
                  background: donutGradient,
                  mask: 'radial-gradient(farthest-side, transparent calc(100% - 8px), black calc(100% - 7px))',
                  WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 8px), black calc(100% - 7px))',
                }}
              />
              {/* Center text */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-black" style={{ color: '#22c55e', textShadow: '0 0 8px rgba(34,197,94,0.5)' }}>
                  {ouRatio.over.toFixed(1)}%
                </span>
                <span className="text-[9px] text-gray-500 font-bold uppercase">Over</span>
              </div>
            </div>
            {/* Stats */}
            <div className="flex items-center gap-4 mt-4">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: '#22c55e' }} />
                <span className="text-[10px] text-gray-400">
                  Over <span className="font-mono font-bold text-white">{ouRatio.over}</span>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: '#ef4444' }} />
                <span className="text-[10px] text-gray-400">
                  Under <span className="font-mono font-bold text-white">{ouRatio.under}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Distribution Quick Ref */}
        <div className="rounded-xl p-4" style={{
          background: 'rgba(22, 27, 34, 0.8)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <h3 className="text-xs font-bold text-white uppercase tracking-wide mb-3" style={{ letterSpacing: '0.08em' }}>
            LIVE DISTRIBUTION
          </h3>
          <div className="space-y-1.5">
            {digitDistribution.map((pct, digit) => {
              const isCurrent = digit === currentDigit;
              const color = isCurrent ? '#00d4aa' : (pct > 12 ? '#22c55e' : pct < 8 ? '#ef4444' : '#eab308');
              return (
                <div key={digit} className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono w-3 text-right ${isCurrent ? 'font-black' : 'font-medium'}`} style={{ color: isCurrent ? '#00d4aa' : '#7d8590' }}>
                    {digit}
                  </span>
                  <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${(pct / digitDistMax) * 100}%`,
                        background: `linear-gradient(90deg, ${color}88, ${color})`,
                        boxShadow: isCurrent ? `0 0 8px ${color}40` : 'none',
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-mono w-10 text-right" style={{ color }}>{pct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

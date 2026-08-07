'use client';

import { useBotStore } from '@/lib/bot-v2/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity } from 'lucide-react';

export function MarketScanner() {
  const { rankedMarkets, marketData, running, phase } = useBotStore();

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Market Scanner
          {running && (
            <Badge variant="outline" className="text-xs ml-auto">
              {phase === 'collecting' ? 'Collecting' : phase === 'scanning' ? 'Scanning' : phase === 'trading' ? 'Trading' : 'Active'}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!running && rankedMarkets.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Start the bot to scan markets
          </p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {rankedMarkets.length > 0 && rankedMarkets.map((m) => (
              <div key={m.symbol} className={`rounded-lg border p-2.5 transition-colors ${m.score > 30 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border'}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold">{m.symbol}</span>
                    <span className="text-xs text-muted-foreground hidden sm:inline">{m.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {m.regime && (
                      <Badge variant="outline" className={`text-[9px] px-1 py-0 ${m.regime === 'strong_signal' ? 'border-emerald-500/50 text-emerald-400' : m.regime === 'weak_signal' ? 'border-yellow-500/50 text-yellow-400' : 'text-gray-500'}`}>
                        {m.regime === 'strong_signal' ? 'STRONG' : m.regime === 'weak_signal' ? 'WEAK' : 'RAND'}
                      </Badge>
                    )}
                    {m.backtestGrade && (
                      <span className={`text-[10px] font-mono font-bold ${m.backtestGrade === 'A' ? 'text-emerald-400' : m.backtestGrade === 'B' ? 'text-green-300' : m.backtestGrade === 'C' ? 'text-yellow-400' : 'text-gray-500'}`}>
                        {m.backtestGrade}
                      </span>
                    )}
                    {m.ev !== undefined && (
                      <span className={`text-[10px] font-mono ${m.ev > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        EV:{m.ev > 0 ? '+' : ''}{m.ev.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground leading-tight line-clamp-2">{m.signal}</p>
              </div>
            ))}
            {marketData.length > 0 && rankedMarkets.length === 0 && marketData.map((m) => (
              <div key={m.symbol} className="rounded-lg border border-border p-2.5">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs font-bold">{m.symbol}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{m.totalTicks} ticks</span>
                    {m.digit >= 0 && <span className="font-mono text-lg font-bold">{m.digit}</span>}
                  </div>
                </div>
                <div className="flex gap-0.5 h-3 items-end">
                  {m.distribution.map((count, d) => (
                    <div
                      key={d}
                      className={`flex-1 rounded-sm transition-all ${d === m.digit ? 'bg-primary' : 'bg-primary/20'}`}
                      style={{ minHeight: '3px', height: `${Math.max(10, (count / (Math.max(...m.distribution, 1))) * 100)}%` }}
                      title={`Digit ${d}: ${count}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

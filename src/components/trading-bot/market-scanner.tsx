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
            {/* Ranked markets (when bot is running) */}
            {rankedMarkets.length > 0 && rankedMarkets.map((m) => (
              <MarketRankRow key={m.symbol} market={m} />
            ))}

            {/* Raw market data (always shown when connected) */}
            {marketData.length > 0 && rankedMarkets.length === 0 && marketData.map((m) => (
              <MarketDataRow key={m.symbol} market={m} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MarketRankRow({ market }: { market: { symbol: string; name: string; score: number; signal: string; totalTicks: number; lastDigit: number } }) {
  const hasSignal = score > 0;
  return (
    <div className={`rounded-lg border p-2.5 transition-colors ${hasSignal ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border'}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold">{market.symbol}</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">{market.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{market.totalTicks} ticks</span>
          <Badge variant={hasSignal ? 'default' : 'secondary'} className={`text-[10px] px-1.5 ${hasSignal ? 'bg-emerald-600' : ''}`}>
            {market.score.toFixed(0)}
          </Badge>
        </div>
      </div>
      {market.signal && (
        <p className="text-[11px] text-muted-foreground leading-tight line-clamp-2">{market.signal}</p>
      )}
    </div>
  );
}

function MarketDataRow({ market }: { market: { symbol: string; name: string; digit: number; price: number; distribution: number[]; totalTicks: number } }) {
  const maxDist = Math.max(...distribution, 1);
  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs font-bold">{market.symbol}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{market.totalTicks} ticks</span>
          {market.digit >= 0 && (
            <span className="font-mono text-lg font-bold">{market.digit}</span>
          )}
        </div>
      </div>
      {/* Mini distribution bar */}
      <div className="flex gap-0.5 h-3 items-end">
        {distribution.map((count, d) => (
          <div
            key={d}
            className={`flex-1 rounded-sm transition-all ${d === market.digit ? 'bg-primary' : 'bg-primary/20'}`}
            style={{ minHeight: '3px', height: `${Math.max(10, (count / maxDist) * 100)}%` }}
            title={`Digit ${d}: ${count}`}
          />
        ))}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef } from 'react';
import { useBotStore } from '@/lib/bot-v2/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { History, ArrowUpRight, ArrowDownRight } from 'lucide-react';

export function TradeHistory() {
  const { tradeHistory } = useBotStore();

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Trade History
          </span>
          <Badge variant="outline" className="text-xs">
            {tradeHistory.length} trades
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {tradeHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No trades yet. Start the bot to begin trading.
          </p>
        ) : (
          <ScrollArea className="max-h-96">
            <div className="space-y-1.5">
              {tradeHistory.map((trade) => (
                <TradeRow key={trade.id} trade={trade} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function TradeRow({ trade }: { trade: {
  id: string; contractType: string; symbol: string; name: string;
  stake: number; payout: number; profit: number; won: boolean;
  timestamp: number; simulated: boolean; barrier: number | undefined;
  ev?: number; regime?: string; backtestGrade?: string;
} }) {
  const time = new Date(trade.timestamp).toLocaleTimeString();

  return (
    <div className={`flex items-center gap-2 rounded-md border p-2 text-xs ${
      trade.won ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'
    }`}>
      <div className={`shrink-0 ${trade.won ? 'text-emerald-500' : 'text-red-500'}`}>
        {trade.won ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono font-bold">{trade.contractType}</span>
          <span className="text-muted-foreground">{trade.symbol}</span>
          {trade.barrier !== undefined && <span className="text-muted-foreground">d{trade.barrier}</span>}
          {trade.backtestGrade && (
            <span className={`font-mono text-[10px] ${trade.backtestGrade === 'A' ? 'text-emerald-400' : 'text-muted-foreground'}`}>{trade.backtestGrade}</span>
          )}
          {trade.ev !== undefined && (
            <span className={`text-[10px] font-mono ${trade.ev > 0 ? 'text-emerald-400' : 'text-red-400'}`}>EV:{trade.ev > 0 ? '+' : ''}{trade.ev.toFixed(2)}</span>
          )}
        </div>
        <div className="text-muted-foreground">{time}</div>
      </div>
      <div className="text-right shrink-0">
        <div className={`font-mono font-bold ${trade.won ? 'text-emerald-500' : 'text-red-500'}`}>
          {trade.profit >= 0 ? '+' : ''}{trade.profit.toFixed(2)}
        </div>
        <div className="text-muted-foreground">${trade.stake.toFixed(2)}</div>
      </div>
    </div>
  );
}
'use client';

import { useEffect, useRef } from 'react';
import { useBotStore } from '@/lib/bot-v2/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Terminal, Trash2 } from 'lucide-react';

export function BotLog() {
  const { logs } = useBotStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-base">
            <Terminal className="h-4 w-4" />
            Bot Log
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => useBotStore.getState().clearLogs()}
            className="h-7 px-2"
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Clear
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          ref={scrollRef}
          className="bg-black/90 rounded-md p-3 font-mono text-[11px] leading-relaxed max-h-80 overflow-y-auto text-green-400 space-y-0.5"
        >
          {logs.length === 0 ? (
            <span className="text-gray-500">Waiting for bot activity...</span>
          ) : (
            logs.map((log, i) => {
              // Color-code log lines
              let colorClass = 'text-green-400';
              if (log.includes('WIN')) colorClass = 'text-emerald-300 font-bold';
              else if (log.includes('LOSS')) colorClass = 'text-red-400';
              else if (log.includes('FAILED') || log.includes('Error') || log.includes('failed')) colorClass = 'text-red-300';
              else if (log.includes('STOP LOSS') || log.includes('TAKE PROFIT')) colorClass = 'text-yellow-300 font-bold';
              else if (log.includes('TRADE:')) colorClass = 'text-cyan-300';
              else if (log.includes('Proposal')) colorClass = 'text-blue-300';
              else if (log.includes('Connected') || log.includes('Authorized') || log.includes('Ready')) colorClass = 'text-emerald-300';
              else if (log.includes('Collecting') || log.includes('Scanning')) colorClass = 'text-gray-400';
              else if (log.includes('Martingale')) colorClass = 'text-orange-300';
              else if (log.includes('Config') || log.includes('STARTED') || log.includes('STOPPED')) colorClass = 'text-purple-300';

              return (
                <div key={i} className={colorClass}>
                  {log}
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

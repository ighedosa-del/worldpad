'use client';

import { useEffect, useRef } from 'react';
import { useBotStore, getBot, destroyBot } from '@/lib/bot-v2/store';
import { ConnectionPanel } from '@/components/trading-bot/connection-panel';
import { BotControls } from '@/components/trading-bot/bot-controls';
import { MarketScanner } from '@/components/trading-bot/market-scanner';
import { TradeHistory } from '@/components/trading-bot/trade-history';
import { BotLog } from '@/components/trading-bot/bot-log';
import { AIBackground } from '@/components/trading-bot/ai-background';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, DollarSign, TrendingUp, BarChart3, Zap, Brain } from 'lucide-react';

export default function Page() {
  const { connected, running, phase, stats, balance, isVirtual, auth, accountList } = useBotStore();
  const autoConnectAttempted = useRef(false);

  // Auto-connect on mount if token is available
  useEffect(() => {
    if (autoConnectAttempted.current) return;
    autoConnectAttempted.current = true;

    const token = process.env.NEXT_PUBLIC_DERIV_TOKEN || sessionStorage.getItem('deriv-token');
    if (token) {
      setTimeout(async () => {
        try {
          const bot = getBot();
          await bot.connect(token);
        } catch {
          // Connection failed — user can retry manually
        }
      }, 500);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroyBot();
    };
  }, []);

  const winRate = stats?.winRate ?? 0;
  const profit = stats?.sessionProfit ?? 0;

  return (
    <div className="relative min-h-screen">
      {/* AI Neural Network Background */}
      <AIBackground />

      {/* Main content above background */}
      <div className="relative z-10 p-3 md:p-6 max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="relative">
              <Brain className="h-6 w-6 text-primary" />
              <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Deriv Trading Bot</h1>
            <Badge variant={isVirtual ? 'secondary' : 'default'} className={isVirtual ? '' : 'bg-red-600'}>
              {isVirtual ? 'DEMO' : 'REAL'}
            </Badge>
            <Badge variant="outline" className="text-[10px] font-mono ml-auto">
              v4 AI Engine
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Neural network analysis with EV scoring, regime filtering, Kelly criterion &amp; adaptive strategy rotation.
          </p>
        </header>

        {/* Stats bar */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard
              icon={<Activity className="h-4 w-4" />}
              label="Cycles"
              value={stats.cycles.toString()}
            />
            <StatCard
              icon={<BarChart3 className="h-4 w-4" />}
              label="Win Rate"
              value={`${winRate.toFixed(1)}%`}
              valueColor={winRate >= 60 ? 'text-emerald-500' : winRate >= 40 ? 'text-yellow-500' : 'text-red-500'}
            />
            <StatCard
              icon={<DollarSign className="h-4 w-4" />}
              label="Session P/L"
              value={`${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`}
              valueColor={profit >= 0 ? 'text-emerald-500' : 'text-red-500'}
            />
            <StatCard
              icon={<TrendingUp className="h-4 w-4" />}
              label="Balance"
              value={`${auth?.currency || 'USD'} $${balance.toFixed(2)}`}
            />
          </div>
        )}

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left column */}
          <div className="lg:col-span-3 space-y-4">
            <ConnectionPanel />
            <BotControls />
          </div>

          {/* Right column */}
          <div className="lg:col-span-9 space-y-4">
            <MarketScanner />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TradeHistory />
              <BotLog />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, valueColor }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <Card className="border-border bg-black/20 backdrop-blur-sm">
      <CardContent className="p-3 flex items-center gap-3">
        <div className="text-muted-foreground">{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={`text-lg font-bold font-mono ${valueColor || ''}`}>{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

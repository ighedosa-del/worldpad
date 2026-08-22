'use client';

import { useBotStore, getBot, destroyBot } from '@/lib/bot-v2/store';
import { STRATEGIES } from '@/lib/bot-v2/strategies';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Play, Square, RotateCcw, Settings2, Zap, AlertTriangle, Crosshair } from 'lucide-react';

export function BotControls() {
  const { connected, running, phase, stats, stake, stopLoss, takeProfit, maxConsecutiveLosses, cycleIntervalMs, isVirtual, ticks, activeStrategy } = useBotStore();
  const avgEV = stats?.avgEV ?? 0;
  const aiStrategies = stats?.aiStrategiesLearned ?? 0;
  const recoveryMode = stats?.recoveryMode ?? false;
  const adaptiveMinEV = stats?.adaptiveMinEV ?? 0;

  const handleStart = () => {
    const bot = getBot();
    bot.updateConfig({ stake, stopLoss, takeProfit, maxConsecutiveLosses, cycleIntervalMs, activeStrategy });
    bot.start();
  };

  const handleStop = () => {
    getBot().stop();
  };

  const handleReset = () => {
    if (running) getBot().stop();
    destroyBot();
    useBotStore.getState().resetSession();
  };

  const updateNum = (key: string, val: string, fallback: number) => {
    const num = parseFloat(val) || fallback;
    useBotStore.getState().setConfig({ [key]: num } as any);
    const bot = getBot();
    bot.updateConfig({ [key]: num } as any);
  };

  const handleStrategyChange = (value: string) => {
    useBotStore.getState().setConfig({ activeStrategy: value });
    const bot = getBot();
    bot.updateConfig({ activeStrategy: value });
  };

  const phaseColors: Record<string, string> = {
    idle: 'bg-gray-500',
    connecting: 'bg-yellow-500',
    collecting: 'bg-blue-500',
    scanning: 'bg-purple-500',
    trading: 'bg-emerald-500',
    stopped: 'bg-red-500',
  };

  const currentStrat = STRATEGIES.find(s => s.id === activeStrategy);

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4" />
            LUCAS v24
          </span>
          <Badge variant="outline" className="text-xs font-mono">
            <span className={`inline-block h-2 w-2 rounded-full mr-1.5 ${phaseColors[phase] || 'bg-gray-500'}`} />
            {phase}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Strategy Selector */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Crosshair className="h-3 w-3" />
            Strategy
          </Label>
          <Select value={activeStrategy} onValueChange={handleStrategyChange} disabled={running}>
            <SelectTrigger className="h-9 text-xs font-mono">
              <SelectValue placeholder="Select strategy" />
            </SelectTrigger>
            <SelectContent>
              {STRATEGIES.map(s => (
                <SelectItem key={s.id} value={s.id} className="text-xs">
                  <div className="flex items-center justify-between w-full gap-4">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground">{s.contractTypes[0]} {(s.expectedWinRate * 100).toFixed(0)}%</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {currentStrat && (
            <p className="text-[10px] text-muted-foreground leading-relaxed">{currentStrat.description}</p>
          )}
        </div>

        {/* Start/Stop buttons */}
        <div className="flex gap-2">
          <Button onClick={handleStart} disabled={!connected || running} className="flex-1" size="sm">
            <Play className="h-4 w-4 mr-1" />
            Start Bot
          </Button>
          <Button onClick={handleStop} disabled={!running} variant="destructive" className="flex-1" size="sm">
            <Square className="h-4 w-4 mr-1" />
            Stop
          </Button>
          <Button onClick={handleReset} variant="outline" size="sm" className="px-3" title="Reset session">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>

        {/* Stats summary */}
        {stats && (
          <>
          <div className="grid grid-cols-4 gap-2">
            <StatBox label="Trades" value={stats.totalTrades.toString()} />
            <StatBox label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} color={stats.winRate >= 60 ? 'text-emerald-500' : stats.winRate >= 40 ? 'text-yellow-500' : 'text-red-500'} />
            <StatBox label="P/L" value={`$${stats.sessionProfit.toFixed(2)}`} color={stats.sessionProfit >= 0 ? 'text-emerald-500' : 'text-red-500'} />
            <StatBox label="Cycles" value={stats.cycles.toString()} />
            <StatBox label="Ticks" value={ticks.toString()} />
            <StatBox label="Stake" value={`$${stats.currentStake.toFixed(2)}`} />
            <StatBox label="Step" value={stats.martingaleStep.toString()} />
            <StatBox label="Strategy" value={currentStrat?.contractTypes[0] || '-'} />
          </div>
          {recoveryMode && (
            <div className="flex items-center gap-2 rounded-md bg-yellow-500/10 border border-yellow-500/20 p-2 text-xs text-yellow-500">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span><strong>Recovery Mode</strong> — reduced stakes after consecutive losses</span>
            </div>
          )}
          </>
        )}

        {/* Config */}
        <div className="space-y-3 pt-2 border-t">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Settings2 className="h-3.5 w-3.5" />
            Configuration
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Stake ($)</Label>
              <Input type="number" step="0.05" min="0.1" value={stake} onChange={(e) => updateNum('stake', e.target.value, 0.40)} disabled={running} className="h-8 text-xs font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Stop Loss ($)</Label>
              <Input type="number" step="1" min="0" value={stopLoss} onChange={(e) => updateNum('stopLoss', e.target.value, 6)} className="h-8 text-xs font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Take Profit ($)</Label>
              <Input type="number" step="1" min="0" value={takeProfit} onChange={(e) => updateNum('takeProfit', e.target.value, 2)} className="h-8 text-xs font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Max Losses</Label>
              <Input type="number" step="1" min="1" max="20" value={maxConsecutiveLosses} onChange={(e) => updateNum('maxConsecutiveLosses', e.target.value, 10)} className="h-8 text-xs font-mono" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Cycle Interval (ms)</Label>
            <Input type="number" step="500" min="1000" max="30000" value={cycleIntervalMs} onChange={(e) => updateNum('cycleIntervalMs', e.target.value, 2000)} disabled={running} className="h-8 text-xs font-mono" />
          </div>
        </div>

        {/* Real money warning */}
        {!isVirtual && connected && (
          <div className="flex items-center gap-2 rounded-md bg-red-500/10 border border-red-500/20 p-2.5 text-xs text-red-500">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span><strong>REAL MONEY</strong> mode. Trades will use real funds.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-md bg-muted/50 p-2 text-center">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-bold font-mono ${color || ''}`}>{value}</div>
    </div>
  );
}

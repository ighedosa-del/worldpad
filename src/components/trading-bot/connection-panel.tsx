'use client';

import { useState } from 'react';
import { useBotStore, getBot, destroyBot } from '@/lib/bot-v2/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, Plug, Unplug, Shield, ShieldCheck } from 'lucide-react';

export function ConnectionPanel() {
  const { connected, auth, isVirtual, balance, connectionError, phase, running, logs } = useBotStore();
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    if (!token.trim()) return;
    setConnecting(true);
    useBotStore.getState().updateState({ connectionError: null });
    try {
      const bot = getBot();
      await bot.connect(token.trim());
      // Persist token for session
      sessionStorage.setItem('deriv-token', token.trim());
    } catch (err) {
      // Error already logged by bot
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    if (running) {
      getBot().stop();
    }
    destroyBot();
    sessionStorage.removeItem('deriv-token');
    useBotStore.getState().updateState({
      connected: false,
      auth: null,
      balance: 0,
      phase: 'idle',
    });
  };

  // Auto-restore token from session storage or env
  const envToken = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_DERIV_TOKEN || '') : '';
  const sessionToken = typeof window !== 'undefined' ? (sessionStorage.getItem('deriv-token') || '') : '';
  const displayToken = token || sessionToken || envToken;

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {connected ? (
            <Wifi className="h-4 w-4 text-emerald-500" />
          ) : (
            <WifiOff className="h-4 w-4 text-muted-foreground" />
          )}
          Connection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Status bar */}
        <div className="flex items-center gap-2 text-sm">
          <div className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'}`} />
          <span className="font-medium">
            {connected ? 'Connected' : connecting ? 'Connecting...' : 'Disconnected'}
          </span>
          {auth && (
            <Badge variant={isVirtual ? 'secondary' : 'default'} className="text-xs">
              {isVirtual ? 'DEMO' : 'REAL'}
            </Badge>
          )}
        </div>

        {/* Account info */}
        {auth && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md bg-muted/50 p-2">
              <div className="text-muted-foreground text-xs">Account</div>
              <div className="font-mono font-medium">{auth.loginid}</div>
            </div>
            <div className="rounded-md bg-muted/50 p-2">
              <div className="text-muted-foreground text-xs">Balance</div>
              <div className={`font-mono font-bold ${balance > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                ${balance.toFixed(2)}
              </div>
            </div>
          </div>
        )}

        {/* Token input */}
        {!connected && (
          <div className="space-y-2">
            <Input
              type="password"
              placeholder="Enter Deriv API token..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              disabled={connecting}
              className="font-mono text-xs"
            />
            {envToken && !token && !sessionToken && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" />
                Token pre-loaded from environment
              </p>
            )}
            <Button
              onClick={handleConnect}
              disabled={connecting || !displayToken}
              className="w-full"
              size="sm"
            >
              <Plug className="h-4 w-4 mr-2" />
              {connecting ? 'Connecting...' : 'Connect'}
            </Button>
          </div>
        )}

        {/* Disconnect button */}
        {connected && (
          <Button
            variant="outline"
            onClick={handleDisconnect}
            disabled={running}
            className="w-full"
            size="sm"
          >
            <Unplug className="h-4 w-4 mr-2" />
            Disconnect
          </Button>
        )}

        {/* Error */}
        {connectionError && (
          <p className="text-xs text-red-500 bg-red-500/10 rounded-md p-2">{connectionError}</p>
        )}
      </CardContent>
    </Card>
  );
}

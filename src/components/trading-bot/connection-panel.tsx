'use client';

import { useState } from 'react';
import { useBotStore, getBot, destroyBot } from '@/lib/bot-v2/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Wifi, WifiOff, Plug, Unplug, ShieldCheck, ArrowLeftRight } from 'lucide-react';

// Token storage keyed by account loginid
const ACCOUNT_TOKENS_KEY = 'deriv-account-tokens';

function getStoredAccountTokens(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(ACCOUNT_TOKENS_KEY) || '{}');
  } catch { return {}; }
}

function setStoredAccountTokens(tokens: Record<string, string>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ACCOUNT_TOKENS_KEY, JSON.stringify(tokens));
}

export function ConnectionPanel() {
  const { connected, auth, isVirtual, balance, connectionError, running, accountList, switchingAccount } = useBotStore();
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [switchTokenInput, setSwitchTokenInput] = useState('');
  const [showTokenDialog, setShowTokenDialog] = useState(false);
  const [pendingSwitchAccount, setPendingSwitchAccount] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!token.trim()) return;
    setConnecting(true);
    useBotStore.getState().updateState({ connectionError: null });
    try {
      const bot = getBot();
      await bot.connect(token.trim());
      sessionStorage.setItem('deriv-token', token.trim());
      const newAuth = bot.getStatus().auth;
      if (newAuth) {
        const stored = getStoredAccountTokens();
        stored[newAuth.loginid] = token.trim();
        setStoredAccountTokens(stored);
      }
    } catch (err) {
      const errMsg = (err as Error).message || 'Connection failed';
      useBotStore.getState().updateState({ connectionError: errMsg });
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
      accountList: [],
    });
  };

  // Account switcher: initiate switch to a different account
  const initiateSwitch = (targetLoginId: string) => {
    const stored = getStoredAccountTokens();
    const existingToken = stored[targetLoginId];
    if (existingToken) {
      performSwitch(targetLoginId, existingToken);
    } else {
      setPendingSwitchAccount(targetLoginId);
      setSwitchTokenInput('');
      setShowTokenDialog(true);
    }
  };

  const performSwitch = async (targetLoginId: string, targetToken: string) => {
    const wasRunning = running;
    if (running) getBot().stop();
    destroyBot();

    useBotStore.getState().updateState({ switchingAccount: true, connectionError: null });

    try {
      const bot = getBot();
      await bot.connect(targetToken);
      const newAuth = bot.getStatus().auth;
      if (newAuth && newAuth.loginid === targetLoginId) {
        sessionStorage.setItem('deriv-token', targetToken);
        const stored = getStoredAccountTokens();
        stored[targetLoginId] = targetToken;
        setStoredAccountTokens(stored);
      }
      if (wasRunning) {
        bot.start();
      }
    } catch (err) {
      const errMsg = (err as Error).message || 'Switch failed';
      useBotStore.getState().updateState({ connectionError: errMsg });
    } finally {
      useBotStore.getState().updateState({ switchingAccount: false });
    }
  };

  const submitSwitchToken = () => {
    if (!switchTokenInput.trim() || !pendingSwitchAccount) return;
    const stored = getStoredAccountTokens();
    stored[pendingSwitchAccount] = switchTokenInput.trim();
    setStoredAccountTokens(stored);
    setShowTokenDialog(false);
    performSwitch(pendingSwitchAccount, switchTokenInput.trim());
  };

  // Filter account list to exclude current account
  const otherAccounts = accountList.filter(a => a.loginid !== auth?.loginid);

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
            {switchingAccount ? 'Switching...' : connected ? 'Connected' : connecting ? 'Connecting...' : 'Disconnected'}
          </span>
          {auth && (
            <Badge variant={isVirtual ? 'secondary' : 'default'} className="text-xs">
              {isVirtual ? 'DEMO' : 'REAL'}
            </Badge>
          )}
        </div>

        {/* Account info */}
        {auth && (
          <>
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

            {/* Account Switcher */}
            {otherAccounts.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ArrowLeftRight className="h-3 w-3" />
                  <span>Switch Account</span>
                </div>
                <Select
                  onValueChange={(loginId) => initiateSwitch(loginId)}
                  disabled={switchingAccount}
                >
                  <SelectTrigger className="h-8 text-xs font-mono">
                    <SelectValue placeholder="Select account..." />
                  </SelectTrigger>
                  <SelectContent>
                    {otherAccounts.map(acc => {
                      const hasToken = !!getStoredAccountTokens()[acc.loginid];
                      return (
                        <SelectItem key={acc.loginid} value={acc.loginid}>
                          <div className="flex items-center gap-2">
                            <Badge variant={acc.isVirtual ? 'secondary' : 'default'} className="text-[9px] px-1 py-0">
                              {acc.isVirtual ? 'DEMO' : 'REAL'}
                            </Badge>
                            <span className="font-mono">{acc.loginid}</span>
                            <span className="text-muted-foreground">({acc.currency})</span>
                            {!hasToken && <span className="text-yellow-500 text-[9px]">+token</span>}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {running && otherAccounts.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">Bot will auto-restart on the new account</p>
                )}
              </div>
            )}

            {/* All accounts overview */}
            {accountList.length > 1 && (
              <div className="space-y-1">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">All Accounts ({accountList.length})</div>
                <div className="flex flex-wrap gap-1">
                  {accountList.map(acc => (
                    <Badge
                      key={acc.loginid}
                      variant={acc.loginid === auth?.loginid ? 'default' : 'outline'}
                      className="text-[9px] font-mono px-1.5 py-0"
                    >
                      {acc.isVirtual ? 'D' : 'R'}:{acc.loginid.slice(-4)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Token + App ID input */}
        {!connected && (
          <div className="space-y-2">
            <Input
              type="password"
              placeholder="Paste your PAT or API token..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              disabled={connecting}
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Paste your Deriv API token (regular or PAT_ format).<br/>
              Token needs <strong>Trade</strong> scope enabled.
            </p>
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
            disabled={running || switchingAccount}
            className="w-full"
            size="sm"
          >
            <Unplug className="h-4 w-4 mr-2" />
            Disconnect
          </Button>
        )}

        {/* Error */}
        {connectionError && (
          <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-md p-2.5 space-y-1">
            <p className="font-medium">{connectionError}</p>
            <p className="text-red-400/70">
              {connectionError.includes('InvalidToken')
                ? 'Token is invalid or expired. Generate a new one at Deriv Settings > API Token with Trade scope.'
                : connectionError.includes('timeout')
                ? 'Connection timed out. Check your internet connection or try again.'
                : connectionError.includes('Cannot create WebSocket')
                ? 'Your browser may not support WebSocket connections.'
                : connectionError.includes('Authorization failed')
                ? 'Authorization failed. Verify your token and account permissions.'
                : 'Make sure your token is correct and has Trade scope enabled.'}
            </p>
          </div>
        )}

        {/* Token dialog for account switch */}
        {showTokenDialog && pendingSwitchAccount && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <Card className="w-80">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Token Required</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Enter the API token for account <span className="font-mono font-bold">{pendingSwitchAccount}</span>.
                  This token will be saved for future switches.
                </p>
                <Input
                  type="password"
                  placeholder="Paste API token..."
                  value={switchTokenInput}
                  onChange={(e) => setSwitchTokenInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitSwitchToken()}
                  className="font-mono text-xs"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowTokenDialog(false)}
                    className="flex-1"
                    size="sm"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={submitSwitchToken}
                    disabled={!switchTokenInput.trim()}
                    className="flex-1"
                    size="sm"
                  >
                    Connect & Switch
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

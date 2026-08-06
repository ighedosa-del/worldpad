'use client';

import { useCallback, useRef, useEffect } from 'react';
import { useWorldpadStore } from '@/lib/store';
import { useTradeExecution } from '@/hooks/use-trade-execution';
import { FREE_BOT_STRATEGIES, getBotBuilderSignal, TradeSignal } from '@/lib/bot-engine';
import { isSimulating } from '@/lib/deriv-ws';

export function useBotRunner() {
  const store = useWorldpadStore();
  const {
    isBotRunning, setIsBotRunning, activeBotId, activeBotStrategy,
    botConfig, addAutoTraderLog, setBotTradeCount, setBotSessionProfit,
    setBotConsecutiveLosses, botSessionProfit, botConsecutiveLosses,
    resetBotSession, botTradeCount, setActiveTab, fastSpeed,
  } = store;

  const { placeTrade } = useTradeExecution();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tradeCountRef = useRef(0);
  const profitRef = useRef(0);
  const lossesRef = useRef(0);
  const currentStakeRef = useRef(botConfig.stake);

  // Sync refs
  useEffect(() => { tradeCountRef.current = botTradeCount; }, [botTradeCount]);
  useEffect(() => { profitRef.current = botSessionProfit; }, [botSessionProfit]);
  useEffect(() => { lossesRef.current = botConsecutiveLosses; }, [botConsecutiveLosses]);

  const getNextSignal = useCallback((): TradeSignal | null => {
    const s = useWorldpadStore.getState();

    // If a free bot is active, use its strategy
    if (activeBotId && FREE_BOT_STRATEGIES[activeBotId]) {
      return FREE_BOT_STRATEGIES[activeBotId](s);
    }

    // If on bot-builder tab, use bot builder strategy
    if (s.activeTab === 'bot-builder') {
      return getBotBuilderSignal(s);
    }

    return null;
  }, [activeBotId]);

  const executeBotCycle = useCallback(async () => {
    const s = useWorldpadStore.getState();

    // Check stop loss
    if (profitRef.current <= -s.botConfig.stopLoss) {
      addAutoTraderLog(`[BOT] Stop loss reached (-$${Math.abs(profitRef.current).toFixed(2)}). Stopping.`);
      setIsBotRunning(false);
      return;
    }

    const signal = getNextSignal();
    if (!signal) return;

    // Calculate stake with martingale
    const stake = currentStakeRef.current;

    addAutoTraderLog(`[BOT] ${signal.contractType} barrier ${signal.barrier ?? '-'} @ $${stake.toFixed(2)} | ${signal.reason}`);

    const result = await placeTrade({
      contractType: signal.contractType,
      barrier: signal.barrier,
      stake,
      duration: 1,
      durationUnit: 't',
    });

    if (!result) return;

    const newCount = tradeCountRef.current + 1;
    const newProfit = profitRef.current + result.profit;

    setBotTradeCount(newCount);
    setBotSessionProfit(newProfit);

    if (result.won) {
      // Reset martingale on win
      currentStakeRef.current = s.botConfig.stake;
      setBotConsecutiveLosses(0);
      lossesRef.current = 0;
    } else {
      // Apply martingale on loss
      const newLosses = lossesRef.current + 1;
      setBotConsecutiveLosses(newLosses);
      lossesRef.current = newLosses;
      currentStakeRef.current = s.botConfig.stake * Math.pow(s.botConfig.martingale, newLosses);

      // Cap stake at 50% of remaining stop loss budget
      const maxStake = Math.max(s.botConfig.stopLoss - Math.abs(newProfit), 0.5) * 0.5;
      currentStakeRef.current = Math.min(currentStakeRef.current, maxStake);
    }

    // Check expected profit target
    if (newProfit >= s.botConfig.expectedProfit) {
      addAutoTraderLog(`[BOT] Profit target reached (+$${newProfit.toFixed(2)}). Stopping.`);
      setIsBotRunning(false);
    }
  }, [getNextSignal, placeTrade, addAutoTraderLog, setIsBotRunning, setBotTradeCount, setBotSessionProfit, setBotConsecutiveLosses]);

  const startBot = useCallback(() => {
    resetBotSession();
    currentStakeRef.current = botConfig.stake;
    tradeCountRef.current = 0;
    profitRef.current = 0;
    lossesRef.current = 0;

    const simMode = isSimulating() || !store.isAuthorized;
    addAutoTraderLog(`[BOT] Starting bot${activeBotId ? ` (${activeBotId})` : ''}... (${simMode ? 'SIMULATION' : 'LIVE'})`);
    addAutoTraderLog(`[BOT] Stake: $${botConfig.stake} | Martingale: x${botConfig.martingale} | Stop Loss: $${botConfig.stopLoss} | Target: $${botConfig.expectedProfit}`);

    setIsBotRunning(true);

    // Clear any existing timer
    if (timerRef.current) clearInterval(timerRef.current);

    const interval = fastSpeed ? 1100 : 2100;
    timerRef.current = setInterval(() => {
      if (useWorldpadStore.getState().isBotRunning) {
        executeBotCycle();
      }
    }, interval);
  }, [resetBotSession, botConfig, activeBotId, addAutoTraderLog, setIsBotRunning, executeBotCycle, fastSpeed, store.isAuthorized]);

  const stopBot = useCallback(() => {
    addAutoTraderLog(`[BOT] Stopped. Trades: ${tradeCountRef.current} | P/L: ${profitRef.current >= 0 ? '+' : ''}$${profitRef.current.toFixed(2)}`);
    setIsBotRunning(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [addAutoTraderLog, setIsBotRunning]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Auto-stop when isBotRunning goes false externally
  useEffect(() => {
    if (!isBotRunning && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [isBotRunning]);

  return { startBot, stopBot, isBotRunning };
}

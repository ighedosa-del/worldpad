'use client';

import { useCallback, useRef, useEffect, useState } from 'react';
import { useWorldpadStore } from '@/lib/store';
import { useTradeExecution } from '@/hooks/use-trade-execution';
import {
  startMultiMarketScan, stopMultiMarketScan, getAllMarketData,
  getMarketData, isScannerConnected, addTickCallback, getScannerHealth,
  SCANNED_MARKETS, type MarketData, type MarketSymbol, type MarketTickData,
} from '@/lib/multi-market-ws';
import { aiEngine } from '@/lib/ai-engine';
import { scoreAllMarkets, selectTrades, feedTickToAI, type RankedMarket } from '@/lib/market-scorer';
import { checkLiveTrade, recordLiveTrade, getLiveStats, preFlightCheck } from '@/lib/real-money-guard';

export interface ScannerHealth {
  isConnected: boolean;
  totalTicksReceived: number;
  lastTickTime: number;
  connectTime: number;
  ticksPerMarket: Record<string, number>;
  wsError: string | null;
  callbackCount: number;
}

export interface AIBotState {
  isRunning: boolean;
  rankedMarkets: RankedMarket[];
  activeTrades: Map<string, { signal: any; startedAt: number }>;
  cycleCount: number;
  totalTradesPlaced: number;
  totalProfit: number;
  scannerConnected: boolean;
  scannerHealth: ScannerHealth;
  lastCycleTime: number;
  status: 'idle' | 'scanning' | 'trading' | 'waiting' | 'stopped';
}

// v2: Per-market loss cooldown tracker
// symbol -> tick count until cooldown expires
const lossCooldowns: Map<string, number> = new Map();
const LOSS_COOLDOWN_TICKS = 4; // skip 4 ticks after a loss on a market

// Track per-market tick counts for cooldown decrementing
const marketTickCounts: Map<string, number> = new Map();

export function useAIBot() {
  const {
    isAuthorized, botConfig, addAutoTraderLog, addTradeResult,
  } = useWorldpadStore();

  const { placeTrade } = useTradeExecution();

  // State
  const [rankedMarkets, setRankedMarkets] = useState<RankedMarket[]>([]);
  const [scannerConnected, setScannerConnected] = useState(false);
  const [scannerHealth, setScannerHealth] = useState<ScannerHealth>({
    isConnected: false, totalTicksReceived: 0, lastTickTime: 0,
    connectTime: 0, ticksPerMarket: {}, wsError: null, callbackCount: 0,
  });
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<AIBotState['status']>('idle');
  const [cycleCount, setCycleCount] = useState(0);
  const [totalTradesPlaced, setTotalTradesPlaced] = useState(0);
  const [learningStats, setLearningStats] = useState(aiEngine.getLearningStats());
  const [stopLossHit, setStopLossHit] = useState(false); // v2

  // Refs
  const runningRef = useRef(false);
  const cycleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTradesRef = useRef<Map<string, { signal: any; startedAt: number }>>(new Map());
  const tradeLocksRef = useRef<Set<string>>(new Set());
  const totalProfitRef = useRef(0);
  const tickDataRef = useRef<Map<string, MarketTickData | null>>(new Map());
  const lastRankingRef = useRef<RankedMarket[]>([]);
  const mountedRef = useRef(true);
  const sessionLossCountRef = useRef(0); // v2: track consecutive losses
  const sessionWinCountRef = useRef(0);

  // Initialize tick data map
  for (const m of SCANNED_MARKETS) {
    tickDataRef.current.set(m.symbol, null);
    if (!marketTickCounts.has(m.symbol)) marketTickCounts.set(m.symbol, 0);
  }

  // === CORE: Force re-score all markets ===
  const doUpdateRanking = useCallback(() => {
    try {
      const allData = Object.values(getAllMarketData());
      const ranked = scoreAllMarkets(allData);
      lastRankingRef.current = ranked;
      if (mountedRef.current) {
        setRankedMarkets(ranked);
      }
    } catch (err) {
      console.error('[AIBot] Ranking error:', err);
    }
  }, []);

  // Throttled version for tick callbacks (max once per 500ms)
  const rankingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateRankingThrottled = useCallback(() => {
    if (rankingTimerRef.current) return;
    rankingTimerRef.current = setTimeout(() => {
      rankingTimerRef.current = null;
      doUpdateRanking();
    }, 500);
  }, [doUpdateRanking]);

  // Tick callback — feeds AI + triggers ranking + decrements cooldowns
  useEffect(() => {
    const unsubscribe = addTickCallback((symbol, data) => {
      tickDataRef.current.set(symbol, data.lastTick);
      feedTickToAI(symbol, data);
      updateRankingThrottled();

      // v2: Increment tick count and decrement cooldown for this market
      const currentTicks = (marketTickCounts.get(symbol) || 0) + 1;
      marketTickCounts.set(symbol, currentTicks);

      const cooldownRemaining = lossCooldowns.get(symbol);
      if (cooldownRemaining !== undefined) {
        if (currentTicks >= cooldownRemaining) {
          lossCooldowns.delete(symbol);
        }
      }
    });
    return unsubscribe;
  }, [updateRankingThrottled]);

  // === FALLBACK: Poll every 1 second to force re-score ===
  useEffect(() => {
    const interval = setInterval(() => {
      if (!mountedRef.current) return;
      const connected = isScannerConnected();
      setScannerConnected(connected);
      const health = getScannerHealth();
      setScannerHealth(health);
      doUpdateRanking();
    }, 1000);
    return () => clearInterval(interval);
  }, [doUpdateRanking]);

  // v2: Build the set of symbols currently in cooldown
  const getCooldownSet = useCallback((): Set<string> => {
    const cooldownSet = new Set<string>();
    for (const [symbol, cooldownUntilTick] of lossCooldowns) {
      const currentTicks = marketTickCounts.get(symbol) || 0;
      if (currentTicks < cooldownUntilTick) {
        cooldownSet.add(symbol);
      }
    }
    return cooldownSet;
  }, []);

  // v2: Put a market into loss cooldown
  const startCooldown = useCallback((symbol: string) => {
    const currentTicks = marketTickCounts.get(symbol) || 0;
    lossCooldowns.set(symbol, currentTicks + LOSS_COOLDOWN_TICKS);
  }, []);

  // Execute a trade on a specific market (per-market lock)
  const executeTradeOnMarket = useCallback(async (market: RankedMarket, stake: number) => {
    if (!market.selectedSignal) return;
    if (tradeLocksRef.current.has(market.symbol)) return;

    // v5: Real Money Guard
    // v6 FIX: Read isAuthorized from store directly (not closure)
    const authorized = useWorldpadStore.getState().isAuthorized;
    const simMode = !authorized;
    const guardResult = checkLiveTrade(stake, !simMode);
    if (!guardResult.allowed) {
      addAutoTraderLog(`[AI] BLOCKED: ${guardResult.reason}`);
      if (guardResult.warnings.length > 0) {
        for (const w of guardResult.warnings) addAutoTraderLog(`[AI] WARNING: ${w}`);
      }
      return;
    }
    if (guardResult.warnings.length > 0) {
      for (const w of guardResult.warnings) addAutoTraderLog(`[AI] WARNING: ${w}`);
    }

    const finalStake = guardResult.cappedStake;
    tradeLocksRef.current.add(market.symbol);

    try {
      const signal = market.selectedSignal;
      const evStr = market.evAdjusted ? ` [EV: ${market.expectedValue.toFixed(3)}]` : '';
      const logMsg = `[AI] ${market.name}: ${signal.contractType} d${signal.barrier ?? '-'} @ $${finalStake.toFixed(2)}${!simMode ? ' LIVE' : ''} | ${signal.reason} | score ${market.combinedScore.toFixed(0)}${evStr}`;
      addAutoTraderLog(logMsg);

      activeTradesRef.current.set(market.symbol, { signal, startedAt: Date.now() });

      const result = await placeTrade({
        contractType: signal.contractType,
        barrier: signal.barrier,
        stake: finalStake,
        symbol: market.symbol,
        duration: 1,
        durationUnit: 't',
      });

      if (result) {
        const won = result.profit > 0;

        // v5: Record live trade for safety tracking
        if (!simMode) {
          const liveResult = recordLiveTrade(result.profit);
          if (liveResult.shouldPause) {
            addAutoTraderLog(`[AI] PAUSED: ${liveResult.message}`);
          }
          if (liveResult.shouldStop) {
            addAutoTraderLog(`[AI] HARD STOP: ${liveResult.message}`);
            runningRef.current = false;
            setIsRunning(false);
            setStatus('stopped');
            aiEngine.saveLearningData();
            return;
          }
        }

        // v2: Per-market loss cooldown
        if (!won) {
          startCooldown(market.symbol);
          sessionLossCountRef.current++;
          // v2: Reset win streak on loss
          sessionWinCountRef.current = 0;
        } else {
          sessionWinCountRef.current++;
          // v2: Reset loss streak on win
          sessionLossCountRef.current = 0;
        }

        const logResult = won
          ? `[AI] WIN  ${market.name}: +$${result.profit.toFixed(2)} | W:${sessionWinCountRef.current} L:${sessionLossCountRef.current}${!simMode ? ' [LIVE]' : ''}`
          : `[AI] LOSS ${market.name}: $${result.profit.toFixed(2)} | W:${sessionWinCountRef.current} L:${sessionLossCountRef.current} | cooldown ${LOSS_COOLDOWN_TICKS} ticks${!simMode ? ' [LIVE]' : ''}`;
        addAutoTraderLog(logResult);

        // Record to AI engine for learning
        aiEngine.recordTradeResult(
          market.symbol, signal.contractType, signal.barrier,
          result.profit, market.combinedScore
        );

        // Record to global trade history (Trading Draft)
        addTradeResult({
          id: `ai-${Date.now()}-${market.symbol}`,
          type: signal.contractType,
          symbol: market.symbol,
          stake: finalStake,
          payout: result.payout || finalStake * 0.85,
          profit: result.profit,
          digit: signal.barrier ?? -1,
          won,
          timestamp: Date.now(),
        });

        totalProfitRef.current += result.profit;
        setTotalTradesPlaced(prev => prev + 1);
        setLearningStats(aiEngine.getLearningStats());
      }
    } catch (err) {
      addAutoTraderLog(`[AI] Error on ${market.name}: ${(err as Error).message}`);
    } finally {
      activeTradesRef.current.delete(market.symbol);
      tradeLocksRef.current.delete(market.symbol);
    }
  }, [isAuthorized, placeTrade, addAutoTraderLog, addTradeResult, startCooldown]);

  // v2: Stop-loss check
  const isStopLossHit = useCallback((): boolean => {
    const stopLoss = botConfig.stopLoss;
    if (stopLoss <= 0) return false; // stop loss disabled
    return totalProfitRef.current <= -stopLoss;
  }, [botConfig.stopLoss]);

  // Main AI bot cycle
  const runCycle = useCallback(async () => {
    if (!runningRef.current) return;

    // v2: STOP-LOSS ENFORCEMENT — hard halt if loss exceeds limit
    if (isStopLossHit()) {
      setStatus('stopped');
      setStopLossHit(true);
      runningRef.current = false;
      setIsRunning(false);
      addAutoTraderLog(`[AI] ⛔ STOP LOSS HIT: -$${Math.abs(totalProfitRef.current).toFixed(2)} exceeded $${botConfig.stopLoss} limit. Bot stopped.`);
      addAutoTraderLog(`[AI] Session stats: ${totalTradesPlaced} trades | W:${sessionWinCountRef.current} L:${sessionLossCountRef.current}`);
      aiEngine.saveLearningData();
      return;
    }

    setStatus('scanning');
    const ranked = lastRankingRef.current;
    if (ranked.length === 0) { setStatus('waiting'); return; }

    // v2: Pass cooldown set to selectTrades
    const cooldownSet = getCooldownSet();
    const trades = selectTrades(ranked, {}, new Set(activeTradesRef.current.keys()), cooldownSet);

    if (trades.length === 0) {
      setStatus('waiting');
      return;
    }

    setStatus('trading');
    setCycleCount(prev => prev + 1);

    // v2: Log EV summary for selected trades
    for (const t of trades) {
      if (t.selectedSignal) {
        addAutoTraderLog(`[AI] → ${t.name}: ${t.selectedSignal.contractType} d${t.selectedSignal.barrier ?? '-'} | EV=${t.expectedValue.toFixed(3)} | score=${t.combinedScore.toFixed(0)} | conf=${Math.round((t.selectedSignal.confidence || 0) * 100)}%`);
      }
    }

    for (const trade of trades) {
      await executeTradeOnMarket(trade, botConfig.stake);
    }
    setStatus('waiting');
  }, [executeTradeOnMarket, botConfig.stake, botConfig.stopLoss, addAutoTraderLog, isStopLossHit, getCooldownSet, totalTradesPlaced]);

  // Start the AI bot
  const startBot = useCallback(() => {
    // v2: Clear all cooldowns on fresh start
    lossCooldowns.clear();
    sessionLossCountRef.current = 0;
    sessionWinCountRef.current = 0;
    setStopLossHit(false);

    aiEngine.loadLearningData();
    setLearningStats(aiEngine.getLearningStats());
    runningRef.current = true;
    setIsRunning(true);
    totalProfitRef.current = 0;
    setCycleCount(0);
    setTotalTradesPlaced(0);
    activeTradesRef.current.clear();
    // v6 FIX: Read isAuthorized from store directly (not closure)
    const authorized = useWorldpadStore.getState().isAuthorized;
    const simMode = !authorized;

    // v5: Pre-flight safety check for live trading
    if (!simMode) {
      const preflight = preFlightCheck(true);
      addAutoTraderLog(`[AI] ═══════════════════════════════════════`);
      addAutoTraderLog(`[AI] === AI BOT v5 STARTED === (LIVE MODE)`);
      addAutoTraderLog(`[AI] REAL MONEY GUARD ACTIVE`);
      addAutoTraderLog(`[AI] Min stake: $0.35 | Max stake: $5.00`);
      addAutoTraderLog(`[AI] Session stop-loss: $10 | Daily stop-loss: $25`);
      addAutoTraderLog(`[AI] Auto-pause after 5 consecutive losses (30s cooldown)`);
      if (!preflight.allowed) {
        addAutoTraderLog(`[AI] BLOCKED: ${preflight.reason}`);
        runningRef.current = false;
        setIsRunning(false);
        addAutoTraderLog(`[AI] ═══════════════════════════════════════`);
        return;
      }
      const stats = getLiveStats();
      addAutoTraderLog(`[AI] Live session: ${stats.totalLiveTrades} trades | P/L: ${stats.totalLiveProfit >= 0 ? '+' : ''}$${stats.totalLiveProfit.toFixed(2)}`);
      addAutoTraderLog(`[AI] ═══════════════════════════════════════`);
    } else {
      addAutoTraderLog(`[AI] ═══════════════════════════════════════`);
      addAutoTraderLog(`[AI] === AI BOT v5 STARTED === (${simMode ? 'SIMULATION' : 'LIVE'})`);
      addAutoTraderLog(`[AI] Scanning ${SCANNED_MARKETS.length} markets | Stake: $${botConfig.stake} | Stop Loss: $${botConfig.stopLoss}`);
      addAutoTraderLog(`[AI] Logic 50% + AI 30% + Patterns 20% | Regime filter ON | Backtest ON`);
      addAutoTraderLog(`[AI] v5: EV filtering | Kelly staking | Strategy rotation | Loss cooldown: ${LOSS_COOLDOWN_TICKS} ticks`);
      addAutoTraderLog(`[AI] ═══════════════════════════════════════`);
    }

    const runLoop = async () => {
      if (!runningRef.current) return;
      await runCycle();
      if (runningRef.current) {
        // v2: 4s cycle (was 2.5s) — slower = more selective
        cycleTimerRef.current = setTimeout(runLoop, 4000);
      }
    };
    runLoop();
  }, [isAuthorized, botConfig, addAutoTraderLog, runCycle]);

  // Stop the AI bot
  const stopBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setStatus('idle');
    if (cycleTimerRef.current) { clearTimeout(cycleTimerRef.current); cycleTimerRef.current = null; }
    stopMultiMarketScan();
    setTimeout(() => {
      if (mountedRef.current) startMultiMarketScan();
    }, 500);
    activeTradesRef.current.clear();
    addAutoTraderLog(`[AI] ═══════════════════════════════════════`);
    addAutoTraderLog(`[AI] === AI BOT v5 STOPPED ===`);
    addAutoTraderLog(`[AI] Cycles: ${cycleCount} | Trades: ${totalTradesPlaced} | P/L: ${totalProfitRef.current >= 0 ? '+' : ''}$${totalProfitRef.current.toFixed(2)}`);
    addAutoTraderLog(`[AI] Session W/L: ${sessionWinCountRef.current}/${sessionLossCountRef.current}`);
    addAutoTraderLog(`[AI] ═══════════════════════════════════════`);
    aiEngine.saveLearningData();
  }, [addAutoTraderLog, cycleCount, totalTradesPlaced]);

  // Start scanning on mount
  useEffect(() => {
    mountedRef.current = true;
    startMultiMarketScan();
    aiEngine.loadLearningData();
    return () => {
      mountedRef.current = false;
      runningRef.current = false;
      if (cycleTimerRef.current) clearTimeout(cycleTimerRef.current);
      if (rankingTimerRef.current) clearTimeout(rankingTimerRef.current);
      stopMultiMarketScan();
    };
  }, []);

  return {
    isRunning, rankedMarkets, scannerConnected, scannerHealth,
    status, cycleCount, totalTradesPlaced,
    totalProfit: totalProfitRef.current,
    learningStats, startBot, stopBot, stopLossHit,
  };
}

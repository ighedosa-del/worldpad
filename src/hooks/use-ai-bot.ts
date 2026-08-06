'use client';

import { useCallback, useRef, useEffect, useState } from 'react';
import { useWorldpadStore } from '@/lib/store';
import { useTradeExecution } from '@/hooks/use-trade-execution';
import {
  startMultiMarketScan, stopMultiMarketScan, getAllMarketData,
  getMarketData, isScannerConnected, addTickCallback,
  SCANNED_MARKETS, type MarketData, type MarketSymbol, type MarketTickData,
} from '@/lib/multi-market-ws';
import { aiEngine } from '@/lib/ai-engine';
import { scoreAllMarkets, selectTrades, feedTickToAI, type RankedMarket } from '@/lib/market-scorer';
import { isSimulating, getProposalWS, buyContractWS } from '@/lib/deriv-ws';

export interface AIBotState {
  isRunning: boolean;
  rankedMarkets: RankedMarket[];
  activeTrades: Map<string, { signal: any; startedAt: number }>;
  cycleCount: number;
  totalTradesPlaced: number;
  totalProfit: number;
  scannerConnected: boolean;
  lastCycleTime: number;
  status: 'idle' | 'scanning' | 'trading' | 'waiting';
}

export function useAIBot() {
  const {
    isAuthorized, botConfig, addAutoTraderLog, addTradeResult,
  } = useWorldpadStore();

  const { placeTrade } = useTradeExecution();

  // State
  const [rankedMarkets, setRankedMarkets] = useState<RankedMarket[]>([]);
  const [scannerConnected, setScannerConnected] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<AIBotState['status']>('idle');
  const [cycleCount, setCycleCount] = useState(0);
  const [totalTradesPlaced, setTotalTradesPlaced] = useState(0);
  const [learningStats, setLearningStats] = useState(aiEngine.getLearningStats());

  // Refs
  const runningRef = useRef(false);
  const cycleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTradesRef = useRef<Map<string, { signal: any; startedAt: number }>>(new Map());
  const tradeLockRef = useRef(false);
  const totalProfitRef = useRef(0);
  const tickDataRef = useRef<Map<string, MarketTickData | null>>(new Map());
  const lastRankingRef = useRef<RankedMarket[]>([]);

  // Initialize tick data map
  for (const m of SCANNED_MARKETS) {
    tickDataRef.current.set(m.symbol, null);
  }

  // Tick callback — updates live data and feeds AI
  useEffect(() => {
    const unsubscribe = addTickCallback((symbol, data) => {
      tickDataRef.current.set(symbol, data.lastTick);

      // Feed to AI engine for learning
      feedTickToAI(symbol, data);

      // Update ranking every ~500ms (always, not just when running)
      updateRanking();
    });
    return unsubscribe;
  }, []);

  // Update market rankings (throttled)
  const rankingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateRanking = useCallback(() => {
    if (rankingTimerRef.current) return;
    rankingTimerRef.current = setTimeout(() => {
      rankingTimerRef.current = null;
      const allData = Object.values(getAllMarketData());
      const ranked = scoreAllMarkets(allData);
      lastRankingRef.current = ranked;
      setRankedMarkets(ranked);
    }, 500);
  }, []);

  // Execute a trade on a specific market
  const executeTradeOnMarket = useCallback(async (market: RankedMarket, stake: number) => {
    if (!market.selectedSignal || tradeLockRef.current) return;
    tradeLockRef.current = true;

    try {
      const signal = market.selectedSignal;
      addAutoTraderLog(`[AI] ${market.name}: ${signal.contractType} d${signal.barrier ?? '-'} @ $${stake.toFixed(2)} | ${signal.reason} | score ${market.combinedScore.toFixed(0)}`);

      // Mark as active trade
      activeTradesRef.current.set(market.symbol, { signal, startedAt: Date.now() });

      const result = await placeTrade({
        contractType: signal.contractType,
        barrier: signal.barrier,
        stake,
        symbol: market.symbol,
        duration: 1,
        durationUnit: 't',
      });

      if (result) {
        // Record result to AI for learning
        aiEngine.recordTradeResult(
          market.symbol,
          signal.contractType,
          signal.barrier,
          result.profit,
          market.combinedScore
        );
        totalProfitRef.current += result.profit;
        setTotalTradesPlaced(prev => prev + 1);
        setLearningStats(aiEngine.getLearningStats());
      }
    } catch (err) {
      addAutoTraderLog(`[AI] Error on ${market.name}: ${(err as Error).message}`);
    } finally {
      activeTradesRef.current.delete(market.symbol);
      tradeLockRef.current = false;
    }
  }, [placeTrade, addAutoTraderLog]);

  // Main AI bot cycle
  const runCycle = useCallback(async () => {
    if (!runningRef.current) return;

    setStatus('scanning');
    const ranked = lastRankingRef.current;

    if (ranked.length === 0) {
      setStatus('waiting');
      return;
    }

    // Select top trades
    const trades = selectTrades(ranked, {}, new Set(activeTradesRef.current.keys()));

    if (trades.length === 0) {
      setStatus('waiting');
      return;
    }

    setStatus('trading');
    setCycleCount(prev => prev + 1);

    // Execute trades on selected markets
    for (const trade of trades) {
      await executeTradeOnMarket(trade, botConfig.stake);
    }

    setStatus('waiting');
  }, [executeTradeOnMarket, botConfig.stake]);

  // Start the AI bot (scanning starts on mount; START only enables trading)
  const startBot = useCallback(() => {
    // Load learning data
    aiEngine.loadLearningData();
    setLearningStats(aiEngine.getLearningStats());

    runningRef.current = true;
    setIsRunning(true);
    totalProfitRef.current = 0;
    setCycleCount(0);
    setTotalTradesPlaced(0);
    activeTradesRef.current.clear();

    const simMode = isSimulating() || !isAuthorized;
    addAutoTraderLog(`[AI] === AI BOT STARTED === (${simMode ? 'SIMULATION' : 'LIVE'})`);
    addAutoTraderLog(`[AI] Scanning ${SCANNED_MARKETS.length} markets | Stake: $${botConfig.stake} | Stop Loss: $${botConfig.stopLoss}`);
    addAutoTraderLog(`[AI] Logic weight 60% + AI weight 40% | Max concurrent: 2`);

    // Start the trading cycle timer (every 2.5 seconds)
    // Note: scanning is already running from mount effect
    const runLoop = async () => {
      if (!runningRef.current) return;
      await runCycle();
      if (runningRef.current) {
        cycleTimerRef.current = setTimeout(runLoop, 2500);
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
    if (rankingTimerRef.current) { clearTimeout(rankingTimerRef.current); rankingTimerRef.current = null; }

    stopMultiMarketScan();
    setScannerConnected(false);
    activeTradesRef.current.clear();

    addAutoTraderLog(`[AI] === AI BOT STOPPED === | Cycles: ${cycleCount} | P/L: ${totalProfitRef.current >= 0 ? '+' : ''}$${totalProfitRef.current.toFixed(2)}`);
    aiEngine.saveLearningData();
    // Restart scanning (keep data flowing, just stop trading)
    startMultiMarketScan();
  }, [addAutoTraderLog, cycleCount]);

  // Track scanner connection + auto-start scanning on mount
  useEffect(() => {
    // Start scanning immediately (data collection, no trading)
    startMultiMarketScan();
    aiEngine.loadLearningData();

    const interval = setInterval(() => {
      setScannerConnected(isScannerConnected());
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (cycleTimerRef.current) clearTimeout(cycleTimerRef.current);
      if (rankingTimerRef.current) clearTimeout(rankingTimerRef.current);
      stopMultiMarketScan();
    };
  }, []);

  return {
    isRunning,
    rankedMarkets,
    scannerConnected,
    status,
    cycleCount,
    totalTradesPlaced,
    totalProfit: totalProfitRef.current,
    learningStats,
    startBot,
    stopBot,
  };
}

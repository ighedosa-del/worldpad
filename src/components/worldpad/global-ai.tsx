'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useWorldpadStore } from '@/lib/store';
import {
  startMultiMarketScan, stopMultiMarketScan, getAllMarketData,
  isScannerConnected, addTickCallback, getScannerHealth,
  SCANNED_MARKETS, addTickCallback as addTickListener, getMarketData,
} from '@/lib/multi-market-ws';
import { aiEngine } from '@/lib/ai-engine';
import { scoreAllMarkets, selectTrades, feedTickToAI, type RankedMarket } from '@/lib/market-scorer';
import { calculateStake, recordRiskResult, resetRiskStates, getSessionPL } from '@/lib/risk-manager';
import { checkLiveTrade, recordLiveTrade, resetLiveSession, getLiveStats, preFlightCheck } from '@/lib/real-money-guard';
import { getProposalWS, buyContractWS, restoreCredentials, getTradeWSStatus } from '@/lib/deriv-ws';
import type { TradeResult } from '@/hooks/use-trade-execution';
import { clearPendingSimTrades } from '@/hooks/use-trade-execution';

// === Pending simulation trades awaiting next tick (for GlobalAI direct trades) ===
const pendingSimTradesGlobal: Map<string, {
  contractType: string;
  barrier: number | undefined;
  stake: number;
  symbol: string;
  resolve: (result: TradeResult | null) => void;
}> = new Map();

let globalTickListenerRegistered = false;

function registerGlobalTickListener() {
  if (globalTickListenerRegistered) return;
  globalTickListenerRegistered = true;

  addTickListener((symbol, data) => {
    const pending = pendingSimTradesGlobal.get(symbol);
    if (!pending || !data.lastTick) return;

    const nextDigit = data.lastTick.digit;
    pendingSimTradesGlobal.delete(symbol);

    const { contractType, barrier, stake, symbol: tradeSymbol } = pending;
    let won = false;
    switch (contractType) {
      case 'DIGITMATCH': won = nextDigit === barrier; break;
      case 'DIGITDIFF': won = nextDigit !== barrier; break;
      case 'DIGITOVER': won = nextDigit > (barrier ?? 4); break;
      case 'DIGITUNDER': won = nextDigit < (barrier ?? 5); break;
      case 'DIGITEVEN': won = nextDigit % 2 === 0; break;
      case 'DIGITODD': won = nextDigit % 2 === 1; break;
      default: won = Math.random() > 0.5;
    }

    // Payout: Deriv pays net profit multiplier on win, 0 on loss
    const isMatch = contractType === 'DIGITMATCH';
    const profitMultiplier = isMatch ? 8.5 : 0.85;
    const profit = won ? stake * profitMultiplier : -stake;
    const payout = won ? stake + profit : 0;

    const result: TradeResult = {
      id: `SIM-${Date.now()}`,
      type: contractType,
      symbol: tradeSymbol,
      stake,
      payout,
      profit,
      digit: barrier ?? -1,
      won,
      timestamp: Date.now(),
      simulated: true,
    };

    pending.resolve(result);
  });
}

async function placeTradeDirect(params: {
  contractType: string;
  barrier?: number;
  stake: number;
  symbol: string;
}): Promise<TradeResult | null> {
  const authorized = useWorldpadStore.getState().isAuthorized;
  const logFn = useWorldpadStore.getState().addAutoTraderLog;

  // === LIVE MODE ===
  if (authorized) {
    try {
      const wsBefore = getTradeWSStatus();
      logFn(`[LIVE] ${params.contractType} ${params.symbol} $${params.stake} d${params.barrier ?? '-'} | ws=${wsBefore.wsReady} auth=${wsBefore.authorized}`);

      const proposal = await getProposalWS({
        contractType: params.contractType,
        symbol: params.symbol,
        stake: params.stake,
        barrier: params.barrier,
        duration: 1,
        durationUnit: 't',
      });

      const buyResult = await buyContractWS(proposal.id, proposal.ask_price);
      const won = buyResult.profit > 0;
      logFn(`[LIVE] ${won ? 'WIN' : 'LOSS'} $${Math.abs(buyResult.profit).toFixed(2)} contract=${buyResult.contract_id}`);
      return {
        id: buyResult.contract_id,
        type: params.contractType,
        symbol: params.symbol,
        stake: params.stake,
        payout: buyResult.payout,
        profit: buyResult.profit,
        digit: params.barrier ?? -1,
        won,
        timestamp: Date.now(),
        simulated: false,
      };
    } catch (err) {
      const errMsg = (err as Error).message || String(err);
      logFn(`[LIVE FAILED] ${errMsg} → SIM fallback`);
      // Fall through to SIM below
    }
  }

  // === SIM MODE (or LIVE fallback) ===
  try {
    const md = getMarketData(params.symbol);
    let nextDigit: number;
    if (md?.lastTick) {
      nextDigit = md.lastTick.digit;
    } else {
      nextDigit = Math.floor(Math.random() * 10);
    }

    const { contractType, barrier, stake } = params;
    let won = false;
    switch (contractType) {
      case 'DIGITMATCH': won = nextDigit === barrier; break;
      case 'DIGITDIFF': won = nextDigit !== barrier; break;
      case 'DIGITOVER': won = nextDigit > (barrier ?? 4); break;
      case 'DIGITUNDER': won = nextDigit < (barrier ?? 5); break;
      case 'DIGITEVEN': won = nextDigit % 2 === 0; break;
      case 'DIGITODD': won = nextDigit % 2 === 1; break;
      default: won = Math.random() > 0.5;
    }

    const isMatch = contractType === 'DIGITMATCH';
    const profitMultiplier = isMatch ? 8.5 : 0.85;
    const profit = won ? stake * profitMultiplier : -stake;
    const payout = won ? stake + profit : 0;

    logFn(`[SIM] ${contractType} ${params.symbol} d${barrier ?? '-'} $${stake} → ${won ? 'WIN +$' + profit.toFixed(2) : 'LOSS -$' + stake.toFixed(2)} (digit=${nextDigit})`);

    return {
      id: `SIM-${Date.now()}`,
      type: contractType,
      symbol: params.symbol,
      stake,
      payout,
      profit,
      digit: barrier ?? -1,
      won,
      timestamp: Date.now(),
      simulated: true,
    };
  } catch (simErr) {
    logFn(`[ERROR] SIM also failed: ${(simErr as Error).message}`);
    return null;
  }
}

/**
 * GlobalAI v2 — invisible background component that runs the AI brain globally.
 * Mounted once in page.tsx. Scans all 10 markets, scores them, auto-trades,
 * and learns — regardless of which tab the user is on.
 * v4: Full system — Pattern Library + Regime Filter + Backtesting +
 * Strategy Rotation + Kelly Staking + EV filtering + stop-loss + cooldowns
 */

// v2: Per-market loss cooldown tracker (shared with use-ai-bot)
const lossCooldownsGlobal: Map<string, number> = new Map();
const LOSS_COOLDOWN_TICKS = 4;
const marketTickCountsGlobal: Map<string, number> = new Map();

export function GlobalAI() {
  const {
    isAuthorized, botConfig, addAutoTraderLog, addTradeResult,
    setGlobalAIRunning, setGlobalAIRankedMarkets, setGlobalAIStatus,
    setGlobalAICycleCount, setGlobalAITotalTrades, setGlobalAITotalProfit,
    setGlobalAILearningStats, setGlobalAIHealth,
  } = useWorldpadStore();

  const runningRef = useRef(false);
  const cycleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTradesRef = useRef<Map<string, { signal: any; startedAt: number }>>(new Map());
  const tradeLocksRef = useRef<Set<string>>(new Set());
  const totalProfitRef = useRef(0);
  const totalTradesRef = useRef(0);
  const cycleCountRef = useRef(0);
  const lastRankingRef = useRef<RankedMarket[]>([]);
  const mountedRef = useRef(true);
  const sessionWinsRef = useRef(0);
  const sessionLossesRef = useRef(0);

  // Init tick counters
  for (const m of SCANNED_MARKETS) {
    if (!marketTickCountsGlobal.has(m.symbol)) marketTickCountsGlobal.set(m.symbol, 0);
  }

  // === Scoring ===
  const rankingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doUpdateRanking = useCallback(() => {
    try {
      const allData = Object.values(getAllMarketData());
      const ranked = scoreAllMarkets(allData);
      lastRankingRef.current = ranked;
      if (mountedRef.current) {
        setGlobalAIRankedMarkets(ranked);
      }
    } catch (err) {
      console.error('[GlobalAI] Ranking error:', err);
    }
  }, [setGlobalAIRankedMarkets]);

  const updateRankingThrottled = useCallback(() => {
    if (rankingTimerRef.current) return;
    rankingTimerRef.current = setTimeout(() => {
      rankingTimerRef.current = null;
      doUpdateRanking();
    }, 500);
  }, [doUpdateRanking]);

  // Tick callback — feeds AI + triggers ranking + manages cooldowns
  useEffect(() => {
    const unsubscribe = addTickCallback((symbol, data) => {
      feedTickToAI(symbol, data);
      updateRankingThrottled();

      // v2: Decrement cooldowns
      const currentTicks = (marketTickCountsGlobal.get(symbol) || 0) + 1;
      marketTickCountsGlobal.set(symbol, currentTicks);
      const cdRemaining = lossCooldownsGlobal.get(symbol);
      if (cdRemaining !== undefined && currentTicks >= cdRemaining) {
        lossCooldownsGlobal.delete(symbol);
      }
    });
    return unsubscribe;
  }, [updateRankingThrottled]);

  // v2: Build cooldown set
  const getCooldownSet = useCallback((): Set<string> => {
    const set = new Set<string>();
    for (const [symbol, untilTick] of lossCooldownsGlobal) {
      if ((marketTickCountsGlobal.get(symbol) || 0) < untilTick) set.add(symbol);
    }
    return set;
  }, []);

  // v2: Stop-loss check
  const isStopLossHit = useCallback((): boolean => {
    if (botConfig.stopLoss <= 0) return false;
    return totalProfitRef.current <= -botConfig.stopLoss;
  }, [botConfig.stopLoss]);

  // === Trade execution ===
  const executeTradeOnMarket = useCallback(async (market: RankedMarket, stake: number) => {
    if (!market.selectedSignal) {
      console.warn('[GlobalAI] executeTradeOnMarket SKIP: no signal for', market.symbol);
      return;
    }
    if (tradeLocksRef.current.has(market.symbol)) {
      console.warn('[GlobalAI] executeTradeOnMarket SKIP: trade locked for', market.symbol);
      return;
    }

    // v5: Real Money Guard — check safety rules
    // v5 FIX: Read isAuthorized from store directly (not closure) to avoid stale values
    const authorized = useWorldpadStore.getState().isAuthorized;
    const simMode = !authorized;
    console.log('[GlobalAI] executeTradeOnMarket: authorized=', authorized, 'simMode=', simMode, 'symbol=', market.symbol);
    // v10: Guard bypassed for debugging — trade always allowed
    const guardResult = { allowed: true, reason: null, cappedStake: stake, warnings: [] as string[] };

    tradeLocksRef.current.add(market.symbol);

    try {
      const signal = market.selectedSignal;
      // v10: Fixed stake — no Kelly for now
      const finalStake = Math.max(0.35, stake);
      const stakeReason = 'fixed';

      const logMsg = `[AI] ${market.name}: ${signal.contractType} d${signal.barrier ?? '-'} @ $${finalStake.toFixed(2)}${simMode ? ' ⚠️SIM' : ' LIVE'} | ${signal.reason} | score ${market.combinedScore.toFixed(0)} | ${stakeReason}`;
      addAutoTraderLog(logMsg);

      activeTradesRef.current.set(market.symbol, { signal, startedAt: Date.now() });

      const result = await placeTradeDirect({
        contractType: signal.contractType,
        barrier: signal.barrier,
        stake: finalStake,
        symbol: market.symbol,
      });

      if (result) {
        const won = result.profit > 0;

        // v5: Record live trade for safety tracking
        // v13 FIX: Use result.simulated (actual outcome) not simMode (store state)
        if (!result.simulated) {
          const liveResult = recordLiveTrade(result.profit);
          if (liveResult.shouldPause) {
            addAutoTraderLog(`[AI] PAUSED: ${liveResult.message}`);
          }
          if (liveResult.shouldStop) {
            addAutoTraderLog(`[AI] HARD STOP: ${liveResult.message}`);
            runningRef.current = false;
            setGlobalAIRunning(false);
            setGlobalAIStatus('idle');
            aiEngine.saveLearningData();
            return;
          }
        }

        // v2: Per-market loss cooldown
        if (!won) {
          const ct = marketTickCountsGlobal.get(market.symbol) || 0;
          lossCooldownsGlobal.set(market.symbol, ct + LOSS_COOLDOWN_TICKS);
          sessionLossesRef.current++;
          sessionWinsRef.current = 0;
        } else {
          sessionWinsRef.current++;
          sessionLossesRef.current = 0;
        }

        addAutoTraderLog(won
          ? `[AI] WIN  ${market.name}: +$${result.profit.toFixed(2)} | W:${sessionWinsRef.current} L:${sessionLossesRef.current}${!simMode ? ' [LIVE]' : ''}`
          : `[AI] LOSS ${market.name}: $${result.profit.toFixed(2)} | W:${sessionWinsRef.current} L:${sessionLossesRef.current} | cooldown ${LOSS_COOLDOWN_TICKS} ticks${!simMode ? ' [LIVE]' : ''}`);

        aiEngine.recordTradeResult(
          market.symbol, signal.contractType, signal.barrier,
          result.profit, market.combinedScore
        );

        // v4: Record to risk manager
        recordRiskResult(market.symbol, result.profit);

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
        totalTradesRef.current += 1;
        if (mountedRef.current) {
          setGlobalAITotalTrades(totalTradesRef.current);
          setGlobalAITotalProfit(totalProfitRef.current);
          setGlobalAILearningStats(aiEngine.getLearningStats());
        }
      } else if (!simMode) {
        // Trade returned null in LIVE mode — error already logged in placeTradeDirect
        addAutoTraderLog(`[AI] ⚠️ Trade on ${market.name} returned no result (live path failed — see error above)`);
      }
    } catch (err) {
      addAutoTraderLog(`[AI] Error on ${market.name}: ${(err as Error).message}`);
    } finally {
      activeTradesRef.current.delete(market.symbol);
      tradeLocksRef.current.delete(market.symbol);
    }
  }, [isAuthorized, addAutoTraderLog, addTradeResult, setGlobalAITotalTrades, setGlobalAITotalProfit, setGlobalAILearningStats]);

  // === Main AI cycle ===
  const runCycle = useCallback(async () => {
    if (!runningRef.current) return;

    // v2: STOP-LOSS ENFORCEMENT
    if (isStopLossHit()) {
      runningRef.current = false;
      if (mountedRef.current) setGlobalAIRunning(false);
      setGlobalAIStatus('idle');
      addAutoTraderLog(`[AI] ⛔ STOP LOSS HIT: -$${Math.abs(totalProfitRef.current).toFixed(2)} exceeded $${botConfig.stopLoss} limit. Bot stopped.`);
      addAutoTraderLog(`[AI] Session: ${totalTradesRef.current} trades | W:${sessionWinsRef.current} L:${sessionLossesRef.current}`);
      aiEngine.saveLearningData();
      return;
    }

    setGlobalAIStatus('scanning');

    const ranked = lastRankingRef.current;
    if (ranked.length === 0) {
      // v13: Log why we're waiting instead of silent return
      const tickCount = Object.values(getAllMarketData()).reduce((sum, md) => sum + (md.tickCount || 0), 0);
      addAutoTraderLog(`[AI] No market data yet — scanner collecting ticks (${tickCount} total so far)...`);
      setGlobalAIStatus('waiting');
      return;
    }

    // v6: Debug — log top 3 markets and why they might not trade
    const top3 = ranked.slice(0, 3);
    for (const m of top3) {
      const hasSignal = !!m.selectedSignal;
      const hasEv = m.expectedValue > 0;
      const evStr = `score=${m.combinedScore.toFixed(0)} signal=${hasSignal} ev=${m.expectedValue.toFixed(3)}`;
      if (!hasSignal) {
        console.log(`[AI Cycle] SKIP ${m.name}: no signal (${evStr})`);
      } else {
        console.log(`[AI Cycle] OK ${m.name}: ${m.selectedSignal?.contractType} d${m.selectedSignal?.barrier} (${evStr})`);
      }
    }

    // v2: Pass cooldown set
    const cooldownSet = getCooldownSet();
    const trades = selectTrades(ranked, {}, new Set(activeTradesRef.current.keys()), cooldownSet);
    // v8: If no trades from scorer, force-trade on the highest-scored market
    // that has distribution data (avoids waiting forever for signals to build)
    if (trades.length === 0) {
      const authorized = useWorldpadStore.getState().isAuthorized;
      const forceTarget = ranked.find(m => {
        const md = getMarketData(m.symbol);
        return md && md.distributionPct.length === 10 && !activeTradesRef.current.has(m.symbol) && !cooldownSet.has(m.symbol);
      });
      if (forceTarget) {
        const md = getMarketData(forceTarget.symbol)!;
        // Pick least frequent digit as barrier
        let minPct = Infinity, minDigit = 0;
        for (let i = 0; i < 10; i++) {
          if (md.distributionPct[i] < minPct) { minPct = md.distributionPct[i]; minDigit = i; }
        }
        forceTarget.selectedSignal = {
          contractType: 'DIGITDIFF',
          barrier: minDigit,
          reason: `[FORCE] d${minDigit} least frequent (${minPct.toFixed(1)}%)`,
          confidence: 0.5,
        };
        trades.push(forceTarget);
        addAutoTraderLog(`[AI] 🔧 FORCED SIGNAL — ${forceTarget.name} DIGITDIFF d${minDigit} (${minPct.toFixed(1)}%)`);
        console.log(`[AI Cycle] FORCE ${forceTarget.name}: DIGITDIFF d${minDigit}`);
      }
    }

    if (trades.length === 0) {
      // v6: Log WHY no trades selected
      const signalsExist = ranked.filter(m => m.selectedSignal).length;
      const cooldownCount = cooldownSet.size;
      const activeCount = activeTradesRef.current.size;
      const distCount = ranked.filter(m => { const md = getMarketData(m.symbol); return md?.distributionPct.length === 10; }).length;
      console.log(`[AI Cycle] NO TRADES — ranked=${ranked.length} withSignal=${signalsExist} withDist=${distCount} cooldowns=${cooldownCount} active=${activeCount}`);
      addAutoTraderLog(`[AI] Waiting... (markets: ${ranked.length}, signals: ${signalsExist}, ready: ${distCount})`);
      setGlobalAIStatus('waiting');
      return;
    }

    setGlobalAIStatus('trading');
    cycleCountRef.current += 1;
    if (mountedRef.current) setGlobalAICycleCount(cycleCountRef.current);

    // v2: Log EV summary for each trade
    for (const t of trades) {
      if (t.selectedSignal) {
        addAutoTraderLog(`[AI] → ${t.name}: ${t.selectedSignal.contractType} d${t.selectedSignal.barrier ?? '-'} | EV=${t.expectedValue.toFixed(3)} | score=${t.combinedScore.toFixed(0)} | conf=${Math.round((t.selectedSignal?.confidence || 0) * 100)}%`);
      }
    }

    // Fire all trades in parallel (per-market locks prevent duplicates)
    const promises = trades.map(trade => executeTradeOnMarket(trade, botConfig.stake));
    await Promise.all(promises);

    setGlobalAIStatus('waiting');
  }, [executeTradeOnMarket, botConfig.stake, botConfig.stopLoss, setGlobalAIStatus, setGlobalAICycleCount, isStopLossHit, getCooldownSet]);

  // === Start / Stop ===
  const startBot = useCallback(() => {
    // v2: Reset everything on fresh start
    lossCooldownsGlobal.clear();
    sessionWinsRef.current = 0;
    sessionLossesRef.current = 0;
    resetRiskStates(); // v4: reset Kelly staking
    resetLiveSession(); // v9: clear persisted guard stats so stale data doesn't block trades

    aiEngine.loadLearningData();
    setGlobalAILearningStats(aiEngine.getLearningStats());
    runningRef.current = true;
    totalProfitRef.current = 0;
    totalTradesRef.current = 0;
    cycleCountRef.current = 0;
    activeTradesRef.current.clear();
    tradeLocksRef.current.clear();
    setGlobalAIRunning(true);
    setGlobalAICycleCount(0);
    setGlobalAITotalTrades(0);
    setGlobalAITotalProfit(0);

    // v6 FIX: Read isAuthorized from store directly (not closure) to avoid stale values
    const authorized = useWorldpadStore.getState().isAuthorized;
    const simMode = !authorized;

    // v5: Pre-flight safety check for live trading
    addAutoTraderLog(`[AI] ═══════════════════════════════════════`);
    addAutoTraderLog(`[AI] === BOT v10 STARTED === mode=${simMode ? 'SIM' : 'LIVE'} authorized=${authorized}`);
    addAutoTraderLog(`[AI] ═══════════════════════════════════════`);

    const runLoop = async () => {
      if (!runningRef.current) return;
      await runCycle();
      if (runningRef.current) {
        // v8: 2s cycle — faster trading
        cycleTimerRef.current = setTimeout(runLoop, 2000);
      }
    };
    runLoop();
  }, [isAuthorized, botConfig, addAutoTraderLog, runCycle, setGlobalAIRunning, setGlobalAICycleCount, setGlobalAITotalTrades, setGlobalAITotalProfit, setGlobalAILearningStats]);

  const stopBot = useCallback(() => {
    runningRef.current = false;
    setGlobalAIRunning(false);
    setGlobalAIStatus('idle');
    if (cycleTimerRef.current) { clearTimeout(cycleTimerRef.current); cycleTimerRef.current = null; }
    activeTradesRef.current.clear();
    tradeLocksRef.current.clear();
    pendingSimTradesGlobal.clear();
    addAutoTraderLog(`[AI] ═══════════════════════════════════════`);
    addAutoTraderLog(`[AI] === GLOBAL AI v5 STOPPED ===`);
    addAutoTraderLog(`[AI] Cycles: ${cycleCountRef.current} | Trades: ${totalTradesRef.current} | P/L: ${totalProfitRef.current >= 0 ? '+' : ''}$${totalProfitRef.current.toFixed(2)}`);
    addAutoTraderLog(`[AI] Session W/L: ${sessionWinsRef.current}/${sessionLossesRef.current}`);
    addAutoTraderLog(`[AI] ═══════════════════════════════════════`);
    aiEngine.saveLearningData();
  }, [addAutoTraderLog, setGlobalAIRunning, setGlobalAIStatus]);

  // Expose start/stop for AI Scanner buttons
  useEffect(() => {
    (window as any).__globalAI = { startBot, stopBot };
    return () => { delete (window as any).__globalAI; };
  }, [startBot, stopBot]);

  // === Init: start scanning + auto-start bot ===
  useEffect(() => {
    mountedRef.current = true;
    aiEngine.loadLearningData();
    setGlobalAILearningStats(aiEngine.getLearningStats());
    startMultiMarketScan();

    // v11: Restore Deriv credentials and start bot regardless of mode
    const store = useWorldpadStore.getState();
    console.log('[GlobalAI] INIT — isAuthorized:', store.isAuthorized, 'mode:', store.accountMode, 'hasDemoToken:', !!store.demoToken, 'hasRealToken:', !!store.realToken, 'accountId:', store.selectedAccountId);

    const initAndStart = async () => {
      // v12: Hardcoded token from .env.local — always connect LIVE
      const envToken = process.env.NEXT_PUBLIC_DERIV_TOKEN;
      const envAppId = process.env.NEXT_PUBLIC_DERIV_APP_ID || '1089';
      let connected = false;

      // ALWAYS log token status for diagnostics
      if (envToken) {
        addAutoTraderLog(`[AUTH] Token found: ${envToken.slice(0, 12)}... (${envToken.length} chars)`);
      } else {
        addAutoTraderLog(`[AUTH] NO TOKEN FOUND in env — will run in SIM mode`);
      }

      if (envToken) {
        addAutoTraderLog(`[AUTH] Connecting to Deriv WebSocket...`);
        console.log('[GlobalAI] Using hardcoded token from .env.local');
        const result = await restoreCredentials(envToken, envAppId);
        if (result) {
          console.log('[GlobalAI] ✅ LIVE connected:', result.loginid, 'balance:', result.balance, 'type:', result.accountType);
          addAutoTraderLog(`[AUTH] ✅ CONNECTED — Account: ${result.loginid} | Balance: $${result.balance.toFixed(2)} ${result.currency} | Mode: ${result.accountType.toUpperCase()}`);
          // Force store into authorized LIVE state
          const s = useWorldpadStore.getState();
          s.setBalance(result.balance);
          s.setAccountInfo({ fullname: result.fullname, loginid: result.loginid, balance: result.balance, currency: result.currency });
          s.setAccountMode(result.accountType);
          s.setSelectedAccountId(result.loginid);
          if (result.accountType === 'demo') s.setDemoToken(envToken); else s.setRealToken(envToken);
          s.setDerivAppId(envAppId);
          s.setIsAuthorized(true);
          connected = true;
        } else {
          console.error('[GlobalAI] ❌ Hardcoded token FAILED to connect');
          addAutoTraderLog(`[AUTH] ❌ TOKEN REJECTED by Deriv — running in SIM mode`);
          addAutoTraderLog(`[AUTH] Check: 1) Token has Trade scope 2) Account is verified 3) Token not expired`);
          // v13 FIX: Explicitly set isAuthorized=false so bot doesn't think it's LIVE
          useWorldpadStore.getState().setIsAuthorized(false);
        }
      } else if (store.isAuthorized && (store.demoToken || store.realToken)) {
        // Fallback: use token from store (user logged in via modal)
        const token = store.accountMode === 'demo' ? store.demoToken : store.realToken;
        if (token) {
          const result = await restoreCredentials(token, store.derivAppId || '1089');
          if (result) {
            useWorldpadStore.getState().setBalance(result.balance);
            useWorldpadStore.getState().setAccountInfo({ fullname: result.fullname, loginid: result.loginid, balance: result.balance, currency: result.currency });
            connected = true;
          }
        }
      }

      // ALWAYS auto-start the bot
      if (mountedRef.current && !runningRef.current) {
        const isLive = useWorldpadStore.getState().isAuthorized;
        console.log('[GlobalAI] Starting bot... mode=', isLive ? 'LIVE' : 'SIM');
        addAutoTraderLog(`[AI] ═══════════════════════════════════════`);
        addAutoTraderLog(`[AI] === BOT STARTED === mode=${isLive ? 'LIVE' : 'SIM'}${connected ? ' ✅ CONNECTED' : ''}`);
        addAutoTraderLog(`[AI] ═══════════════════════════════════════`);
        startBot();
      }
    };

    // Wait 5s for scanner to collect some data, then start
    const autoStartTimer = setTimeout(initAndStart, 5000);

    return () => {
      mountedRef.current = false;
      runningRef.current = false;
      if (cycleTimerRef.current) clearTimeout(cycleTimerRef.current);
      if (rankingTimerRef.current) clearTimeout(rankingTimerRef.current);
      clearTimeout(autoStartTimer);
      pendingSimTradesGlobal.clear();
      stopMultiMarketScan();
    };
  }, []);

  // Health monitoring
  useEffect(() => {
    const interval = setInterval(() => {
      if (!mountedRef.current) return;
      const connected = isScannerConnected();
      const health = getScannerHealth();
      if (mountedRef.current) {
        setGlobalAIHealth({
          isConnected: connected,
          totalTicksReceived: health.totalTicksReceived,
          lastTickTime: health.lastTickTime,
          connectTime: health.connectTime,
          ticksPerMarket: health.ticksPerMarket,
          wsError: health.wsError,
          callbackCount: health.callbackCount,
        });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [setGlobalAIHealth]);

  // v13: REMOVED the isAuthorized restart effect.
  // This was causing a CRITICAL race condition:
  //   1) initAndStart (t=5s) connects WS + sets isAuthorized=true + starts bot
  //   2) This effect fires because isAuthorized changed
  //   3) It calls restoreCredentials AGAIN → kills the WS initAndStart just connected
  //   4) It stops the running bot and restarts it → bot loop of death
  // initAndStart now handles EVERYTHING: auth, store update, and bot start.
  // No secondary effect needed.

  // Listen for trades from ANY tab and feed AI learning
  useEffect(() => {
    const unsub = useWorldpadStore.subscribe(
      (state) => state.tradeHistory,
      (history) => {
        if (history.length === 0) return;
        const last = history[history.length - 1];
        if (last.id.startsWith('ai-')) return;
        aiEngine.recordTradeResult(
          last.symbol, last.type, last.digit >= 0 ? last.digit : undefined,
          last.profit, 50
        );
      }
    );
    return unsub;
  }, []);

  return null;
}
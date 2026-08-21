'use client';

import { useCallback } from 'react';
import { useWorldpadStore } from '@/lib/store';
import { getProposalWS, buyContractWS } from '@/lib/deriv-ws';
import { addTickCallback, type MarketSymbol } from '@/lib/multi-market-ws';

export interface TradeParams {
  contractType: string;
  barrier?: number;
  stake: number;
  symbol?: string;
  duration?: number;
  durationUnit?: string;
}

export interface TradeResult {
  id: string;
  type: string;
  symbol: string;
  stake: number;
  payout: number;
  profit: number;
  digit: number;
  won: boolean;
  timestamp: number;
  simulated: boolean;
}

export interface PendingSimTrade {
  params: TradeParams;
  tradeSymbol: string;
  resolve: (result: TradeResult | null) => void;
  symbol: MarketSymbol;
}

// Global queue of pending simulation trades waiting for the next tick
const pendingSimTrades: Map<string, PendingSimTrade> = new Map();
let globalTickListenerRegistered = false;

function registerGlobalTickListener() {
  if (globalTickListenerRegistered) return;
  globalTickListenerRegistered = true;

  addTickCallback((symbol, data) => {
    const pending = pendingSimTrades.get(symbol);
    if (!pending || !data.lastTick) return;

    const nextDigit = data.lastTick.digit;
    pendingSimTrades.delete(symbol);

    const { params, tradeSymbol } = pending;
    let won = false;
    switch (params.contractType) {
      case 'DIGITMATCH': won = nextDigit === params.barrier; break;
      case 'DIGITDIFF': won = nextDigit !== params.barrier; break;
      case 'DIGITOVER': won = nextDigit > (params.barrier ?? 4); break;
      case 'DIGITUNDER': won = nextDigit < (params.barrier ?? 5); break;
      case 'DIGITEVEN': won = nextDigit % 2 === 0; break;
      case 'DIGITODD': won = nextDigit % 2 === 1; break;
      default: won = Math.random() > 0.5;
    }

    // Payout: Deriv pays net profit multiplier on win, 0 on loss
    // DIGITMATCH: ~8.5x profit | DIGITDIFF/OVER/UNDER/EVEN/ODD: ~0.85x profit
    const isMatch = params.contractType === 'DIGITMATCH';
    const profitMultiplier = isMatch ? 8.5 : 0.85;
    const profit = won ? params.stake * profitMultiplier : -params.stake;
    const payout = won ? params.stake + profit : 0;

    const result: TradeResult = {
      id: `SIM-${Date.now()}`,
      type: params.contractType,
      symbol: tradeSymbol,
      stake: params.stake,
      payout,
      profit,
      digit: params.barrier ?? -1,
      won,
      timestamp: Date.now(),
      simulated: true,
    };

    // Log via store (synchronous top-level import)
    const store = useWorldpadStore.getState();
    store.addTradeResult(result);
    store.addAutoTraderLog(`[SIM] ${won ? 'WIN' : 'LOSS'}: ${params.contractType} on ${tradeSymbol} barrier ${params.barrier ?? '-'} | next digit was ${nextDigit} | ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`);

    pending.resolve(result);
  });
}

export function clearPendingSimTrades() {
  pendingSimTrades.clear();
}

export function useTradeExecution() {
  const {
    isAuthorized, activeMarket, addTradeResult,
    setIsPlacingTrade, isPlacingTrade, addAutoTraderLog, currentDigit,
  } = useWorldpadStore();

  if (typeof window !== 'undefined') {
    registerGlobalTickListener();
  }

  const placeTrade = useCallback(async (params: TradeParams): Promise<TradeResult | null> => {
    const tradeSymbol = params.symbol || activeMarket;
    // v6 FIX: Read isAuthorized from store directly (not closure) to avoid stale values
    const authorized = useWorldpadStore.getState().isAuthorized;
    const simMode = !authorized;
    console.log('[TradeExec] placeTrade simMode=', simMode, 'isAuthorized=', authorized);

    try {
      if (simMode) {
        const marketSymbol = (params.symbol || activeMarket) as MarketSymbol;
        if (pendingSimTrades.has(marketSymbol)) return null;

        return new Promise<TradeResult | null>((resolve) => {
          const timeout = setTimeout(() => {
            pendingSimTrades.delete(marketSymbol);
            resolve(null);
          }, 15000);

          pendingSimTrades.set(marketSymbol, {
            params,
            tradeSymbol,
            resolve: (r) => { clearTimeout(timeout); resolve(r); },
            symbol: marketSymbol,
          });
        });
      }

      // LIVE MODE
      addAutoTraderLog(`Placing ${params.contractType} trade on ${tradeSymbol}...`);
      const proposal = await getProposalWS({
        contractType: params.contractType,
        symbol: tradeSymbol,
        stake: params.stake,
        barrier: params.barrier,
        duration: params.duration || 1,
        durationUnit: params.durationUnit || 't',
      });
      addAutoTraderLog(`Proposal received — payout: $${proposal.payout.toFixed(2)}`);
      const buyResult = await buyContractWS(proposal.id, proposal.ask_price);
      const won = buyResult.profit > 0;
      const result: TradeResult = {
        id: buyResult.contract_id,
        type: params.contractType,
        symbol: tradeSymbol,
        stake: params.stake,
        payout: buyResult.payout,
        profit: buyResult.profit,
        digit: params.barrier ?? -1,
        won,
        timestamp: Date.now(),
        simulated: false,
      };
      addTradeResult(result);
      addAutoTraderLog(`${won ? 'WIN' : 'LOSS'}: ${params.contractType} — ${won ? '+$' : '-$'}${Math.abs(result.profit).toFixed(2)}`);
      return result;
    } catch (err) {
      addAutoTraderLog(`ERROR on ${tradeSymbol}: ${(err as Error).message}`);
      return null;
    }
  }, [isAuthorized, activeMarket, currentDigit, addTradeResult, addAutoTraderLog]);

  const quickTrade = useCallback(async (type: 'match' | 'differ' | 'over' | 'under' | 'even' | 'odd', digit: number, stake: number) => {
    const contractMap = {
      match: 'DIGITMATCH', differ: 'DIGITDIFF',
      over: 'DIGITOVER', under: 'DIGITUNDER',
      even: 'DIGITEVEN', odd: 'DIGITODD',
    };
    return placeTrade({
      contractType: contractMap[type], barrier: digit, stake,
      duration: 1, durationUnit: 't',
    });
  }, [placeTrade]);

  return { placeTrade, quickTrade, isPlacingTrade };
}

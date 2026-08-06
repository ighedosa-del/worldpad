'use client';

import { useCallback } from 'react';
import { useWorldpadStore } from '@/lib/store';
import { isSimulating, getProposalWS, buyContractWS } from '@/lib/deriv-ws';

export interface TradeParams {
  contractType: string;  // DIGITOVER, DIGITUNDER, DIGITMATCH, DIGITDIFF, DIGITEVEN, DIGITODD
  barrier?: number;      // 0-9 for digit barrier
  stake: number;
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

export function useTradeExecution() {
  const {
    apiToken, isAuthorized, activeMarket, addTradeResult,
    setIsPlacingTrade, isPlacingTrade, addAutoTraderLog, currentDigit,
  } = useWorldpadStore();

  const placeTrade = useCallback(async (params: TradeParams): Promise<TradeResult | null> => {
    if (isPlacingTrade) return null;

    setIsPlacingTrade(true);
    const simMode = isSimulating() || !isAuthorized || !apiToken;

    try {
      if (simMode) {
        // === SIMULATION MODE ===
        let won = false;
        switch (params.contractType) {
          case 'DIGITMATCH': won = currentDigit === params.barrier; break;
          case 'DIGITDIFF': won = currentDigit !== params.barrier; break;
          case 'DIGITOVER': won = currentDigit > (params.barrier ?? 4); break;
          case 'DIGITUNDER': won = currentDigit < (params.barrier ?? 5); break;
          case 'DIGITEVEN': won = currentDigit % 2 === 0; break;
          case 'DIGITODD': won = currentDigit % 2 === 1; break;
          default: won = Math.random() > 0.5;
        }

        const isMatch = params.contractType === 'DIGITMATCH';
        const isDiffer = params.contractType === 'DIGITDIFF';
        const payout = won
          ? params.stake * (isMatch ? 8.5 : isDiffer ? 0.85 : 0.85)
          : 0;
        const profit = payout - params.stake;

        const result: TradeResult = {
          id: `SIM-${Date.now()}`,
          type: params.contractType,
          symbol: activeMarket,
          stake: params.stake,
          payout,
          profit,
          digit: params.barrier ?? -1,
          won,
          timestamp: Date.now(),
          simulated: true,
        };

        addTradeResult(result);
        addAutoTraderLog(`[SIM] ${won ? 'WIN' : 'LOSS'}: ${params.contractType} barrier ${params.barrier ?? '-'} | digit was ${currentDigit} | ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`);
        return result;
      }

      // === LIVE MODE via WebSocket ===
      addAutoTraderLog(`Placing ${params.contractType} trade on ${activeMarket}...`);

      // Step 1: Get proposal via WebSocket
      const proposal = await getProposalWS({
        contractType: params.contractType,
        symbol: activeMarket,
        stake: params.stake,
        barrier: params.barrier,
        duration: params.duration || 1,
        durationUnit: params.durationUnit || 't',
      });

      addAutoTraderLog(`Proposal received — payout: $${proposal.payout.toFixed(2)}`);

      // Step 2: Buy the contract via WebSocket
      const buyResult = await buyContractWS(proposal.id, proposal.ask_price);

      const won = buyResult.profit > 0;
      const result: TradeResult = {
        id: buyResult.contract_id,
        type: params.contractType,
        symbol: activeMarket,
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
      addAutoTraderLog(`ERROR: ${(err as Error).message}`);
      return null;
    } finally {
      setIsPlacingTrade(false);
    }
  }, [apiToken, isAuthorized, activeMarket, isPlacingTrade, currentDigit, addTradeResult, setIsPlacingTrade, addAutoTraderLog]);

  const quickTrade = useCallback(async (type: 'match' | 'differ' | 'over' | 'under' | 'even' | 'odd', digit: number, stake: number) => {
    const contractMap = {
      match: 'DIGITMATCH',
      differ: 'DIGITDIFF',
      over: 'DIGITOVER',
      under: 'DIGITUNDER',
      even: 'DIGITEVEN',
      odd: 'DIGITODD',
    };
    return placeTrade({
      contractType: contractMap[type],
      barrier: digit,
      stake,
      duration: 1,
      durationUnit: 't',
    });
  }, [placeTrade]);

  return { placeTrade, quickTrade, isPlacingTrade };
}

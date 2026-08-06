'use client';

import type { MarketData, MarketSymbol } from './multi-market-ws';
import { scoreMarketLogic, LogicScore, TradeSignal } from './logic-engine';
import { aiEngine, AIScore } from './ai-engine';

// === Market Scorer ===
// Combines Logic (60%) + AI (40%) scores, ranks all markets,
// and selects the top ones for trading.

export interface RankedMarket {
  symbol: MarketSymbol;
  name: string;
  type: 'standard' | 'fast';
  combinedScore: number;
  logicScore: LogicScore;
  aiScore: AIScore;
  selectedSignal: TradeSignal | null;
  rank: number;
}

export interface ScoringConfig {
  logicWeight: number;     // default 0.6
  aiWeight: number;        // default 0.4
  minScore: number;        // minimum combined score to trade (default 55)
  maxConcurrentTrades: number; // max markets to trade at once (default 2)
}

const DEFAULT_CONFIG: ScoringConfig = {
  logicWeight: 0.6,
  aiWeight: 0.4,
  minScore: 55,
  maxConcurrentTrades: 2,
};

// Feed tick data to the AI engine (called on every tick)
export function feedTickToAI(symbol: string, data: MarketData) {
  aiEngine.processTick(symbol, data);
}

// Score all markets and return ranked list
export function scoreAllMarkets(
  markets: MarketData[],
  config: Partial<ScoringConfig> = {}
): RankedMarket[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const ranked: RankedMarket[] = [];

  for (const market of markets) {
    const logicScore = scoreMarketLogic(market);
    const aiScore = aiEngine.analyzeMarket(market);

    const combinedScore = logicScore.score * cfg.logicWeight + aiScore.score * cfg.aiWeight;

    // Select the best signal: prefer whichever engine (Logic or AI) has higher confidence
    let selectedSignal: TradeSignal | null = null;
    if (logicScore.signal && aiScore.signal) {
      selectedSignal = logicScore.signal.confidence >= aiScore.signal.confidence
        ? logicScore.signal
        : aiScore.signal;
    } else if (logicScore.signal) {
      selectedSignal = logicScore.signal;
    } else if (aiScore.signal) {
      selectedSignal = aiScore.signal;
    }

    ranked.push({
      symbol: market.symbol,
      name: market.name,
      type: market.type,
      combinedScore,
      logicScore,
      aiScore,
      selectedSignal,
      rank: 0,
    });
  }

  // Sort by combined score descending
  ranked.sort((a, b) => b.combinedScore - a.combinedScore);

  // Assign ranks
  ranked.forEach((m, i) => m.rank = i + 1);

  return ranked;
}

// Get the top markets that should be traded
export function selectTrades(
  ranked: RankedMarket[],
  config: Partial<ScoringConfig> = {},
  activeTradeSymbols: Set<string> = new Set()
): RankedMarket[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  return ranked
    .filter(m => {
      // Must meet minimum score
      if (m.combinedScore < cfg.minScore) return false;
      // Must have a signal
      if (!m.selectedSignal) return false;
      // Must not already have an active trade on this market
      if (activeTradeSymbols.has(m.symbol)) return false;
      return true;
    })
    .slice(0, cfg.maxConcurrentTrades);
}

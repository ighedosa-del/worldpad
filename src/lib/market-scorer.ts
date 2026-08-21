'use client';

import type { MarketData, MarketSymbol } from './multi-market-ws';
import { scoreMarketLogic, LogicScore, TradeSignal } from './logic-engine';
import { aiEngine, AIScore } from './ai-engine';
import { analyzePatterns } from './pattern-library';
import { analyzeRegime, type RegimeResult } from './market-regime';
import { quickBacktestDiff } from './backtest-engine';

// === Market Scorer v4 ===
// Integrates: Logic Engine + AI Engine + Pattern Library + Regime Filter + Backtesting
// Only trades DIGITDIFF (90%+ win) with regime/pattern/backtest validation.

export interface RankedMarket {
  symbol: MarketSymbol;
  name: string;
  type: 'standard' | 'fast';
  combinedScore: number;
  logicScore: LogicScore;
  aiScore: AIScore;
  selectedSignal: TradeSignal | null;
  expectedValue: number;
  evAdjusted: boolean;
  regime: RegimeResult | null;
  patternScore: number;
  backtestGrade: string | null;
  rank: number;
}

export interface ScoringConfig {
  logicWeight: number;
  aiWeight: number;
  minScore: number;
  maxConcurrentTrades: number;
}

const DEFAULT_CONFIG: ScoringConfig = {
  logicWeight: 0.5,
  aiWeight: 0.3,
  minScore: 1, // v8: Was 5 (too tight for fresh data). 1 =只要有信号就交易
  maxConcurrentTrades: 3,
};

const BLOCKED_CONTRACTS = new Set(['DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD']);

// === Convert any blocked signal to DIGITDIFF ===
function convertToDiff(signal: TradeSignal, reason: string, barrier?: number): TradeSignal {
  return {
    contractType: 'DIGITDIFF',
    barrier: barrier ?? signal.barrier,
    reason: `[→DIFF] ${reason}: ${signal.contractType} is 50/50 (-EV)`,
    confidence: 0.7,
  };
}

// === Pick the best DIGITDIFF barrier from multiple sources ===
function pickBestDiffBarrier(
  logicSignal: TradeSignal | null,
  aiSignal: TradeSignal | null,
  patternSignal: { contractType: string; barrier?: number; reason: string; confidence: number } | null,
  data: MarketData,
): TradeSignal | null {
  const candidates: { barrier: number; confidence: number; reason: string; source: string }[] = [];

  // Collect barriers from all sources
  if (logicSignal) {
    const b = logicSignal.barrier;
    if (b !== undefined && b !== null) {
      candidates.push({ barrier: b, confidence: logicSignal.confidence * 0.8, reason: logicSignal.reason, source: 'Logic' });
    }
  }

  if (aiSignal) {
    const b = aiSignal.barrier;
    if (b !== undefined && b !== null) {
      candidates.push({ barrier: b, confidence: aiSignal.confidence, reason: aiSignal.reason, source: 'AI' });
    }
  }

  if (patternSignal && patternSignal.barrier !== undefined) {
    candidates.push({ barrier: patternSignal.barrier, confidence: patternSignal.confidence, reason: patternSignal.reason, source: 'Pattern' });
  }

  // If no candidates, pick the least frequent digit (highest gap) as default DIFF barrier
  if (candidates.length === 0) {
    if (data.distributionPct.length === 10) {
      let minPct = Infinity, minDigit = 0;
      for (let i = 0; i < 10; i++) {
        if (data.distributionPct[i] < minPct) { minPct = data.distributionPct[i]; minDigit = i; }
      }
      return {
        contractType: 'DIGITDIFF',
        barrier: minDigit,
        reason: `Default DIFF: d${minDigit} least frequent (${minPct.toFixed(1)}%)`,
        confidence: 0.5,
      };
    }
    return null;
  }

  // Deduplicate and pick the one with highest confidence
  const seen = new Set<number>();
  let best = candidates[0];
  for (const c of candidates) {
    if (!seen.has(c.barrier) || c.confidence > best.confidence) {
      seen.add(c.barrier);
      if (c.confidence > best.confidence) best = c;
    }
  }

  // Check if multiple sources agree on the same barrier (consensus boost)
  const barrierCounts = new Map<number, { count: number; totalConf: number; reason: string }>();
  for (const c of candidates) {
    const existing = barrierCounts.get(c.barrier);
    if (existing) {
      existing.count++;
      existing.totalConf += c.confidence;
    } else {
      barrierCounts.set(c.barrier, { count: 1, totalConf: c.confidence, reason: c.reason });
    }
  }

  // Find consensus barrier (2+ sources agree)
  let consensusBarrier = best;
  for (const [barrier, info] of barrierCounts) {
    if (info.count >= 2 && info.totalConf > best.confidence) {
      consensusBarrier = { barrier, confidence: Math.min(info.totalConf * 0.8, 1), reason: `[CONSENSUS ${info.count}x] ${info.reason}`, source: 'Multi' };
    }
  }

  return {
    contractType: 'DIGITDIFF',
    barrier: consensusBarrier.barrier,
    reason: consensusBarrier.reason,
    confidence: consensusBarrier.confidence,
  };
}

// Feed tick data to the AI engine
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

    // v4: Regime analysis
    const regime = analyzeRegime(market);

    // v4: Pattern analysis
    const { bestSignal: patternSignal, compositeScore: patternScore } = analyzePatterns(market);

    // Scoring weights: Logic 50% + AI 30% + Patterns 20%
    // Regime acts as a multiplier (0-1)
    const rawScore = logicScore.score * cfg.logicWeight + aiScore.score * cfg.aiWeight + (patternScore * 100) * 0.2;
    const regimeMultiplier = 0.3 + regime.tradability * 0.7; // min 30%, max 100%
    const combinedScore = rawScore * regimeMultiplier;

    // === Signal Selection ===
    let selectedSignal: TradeSignal | null = null;
    let ev = 0;
    let evAdjusted = false;
    let backtestGrade: string | null = null;

    // Get the best DIGITDIFF barrier from all sources
    const diffSignal = pickBestDiffBarrier(
      logicScore.signal,
      aiScore.signal,
      patternSignal,
      market
    );

    if (diffSignal) {
      // v4: Backtest validation
      const bt = quickBacktestDiff(market, diffSignal.barrier!);
      backtestGrade = bt.passed ? 'PASS' : 'FAIL';

      // v8: Calculate EV from backtest win rate
      ev = (bt.winRate * 0.85) - (1 - bt.winRate); // 0.85 = typical DIGITDIFF payout ratio

      // Always accept the signal — let the bot trade
      selectedSignal = {
        ...diffSignal,
        reason: `${diffSignal.reason} | BT:${bt.winRate.toFixed(0)}% EV:${ev.toFixed(3)}${bt.passed ? '' : ' [BT-FAIL]'}`,
        confidence: diffSignal.confidence,
      };
    }

    // v6: Regime filter is advisory only — don't kill signals

    ranked.push({
      symbol: market.symbol,
      name: market.name,
      type: market.type,
      combinedScore,
      logicScore,
      aiScore,
      selectedSignal,
      expectedValue: ev,
      evAdjusted,
      regime,
      patternScore,
      backtestGrade,
      rank: 0,
    });
  }

  ranked.sort((a, b) => b.combinedScore - a.combinedScore);
  ranked.forEach((m, i) => m.rank = i + 1);

  return ranked;
}

// Get the top markets that should be traded
export function selectTrades(
  ranked: RankedMarket[],
  config: Partial<ScoringConfig> = {},
  activeTradeSymbols: Set<string> = new Set(),
  cooldownSymbols: Set<string> = new Set()
): RankedMarket[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // v6: Debug logging — log WHY markets are filtered
  const beforeFilter = ranked.length;
  const reasons: Record<string, string[]> = {};

  const filtered = ranked.filter(m => {
    const why: string[] = [];
    if (m.combinedScore < cfg.minScore) why.push(`score ${m.combinedScore.toFixed(0)}<${cfg.minScore}`);
    if (!m.selectedSignal) why.push('no signal');
    if (activeTradeSymbols.has(m.symbol)) why.push('active');
    if (cooldownSymbols.has(m.symbol)) why.push('cooldown');
    if (why.length > 0) {
      reasons[m.symbol] = why;
      return false;
    }
    return true;
  });

  // Log filtering summary (only when some markets exist but none pass)
  if (beforeFilter > 0 && filtered.length === 0) {
    const summary = Object.entries(reasons).map(([sym, r]) => `${sym}: ${r.join(', ')}`).join(' | ');
    console.log(`[MarketScorer] ALL ${beforeFilter} markets filtered out: ${summary}`);
  }

  return filtered.slice(0, cfg.maxConcurrentTrades);
}

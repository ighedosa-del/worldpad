'use client';

// === Market Features — Ported from LUCAS market-hub.mjs _features() ===
// 7 strategy types with regime/volatility detection from price data
// This extracts features from TICK PRICES (not digits) for richer signal logic.

import { ema, rsi, stddev, bollingerWidth, clamp } from './lucas-math';

export interface MarketFeatures {
  ready: boolean;
  count: number;
  ema9: number | null;
  ema21: number | null;
  rsi: number | null;
  rsi5: number | null;
  volatility: number;
  momentum: number;
  trend: number;
  bollingerWidth: number;
  bwDelta: number;
  volatilityState: 'EXPANDING' | 'CONTRACTING' | 'NEUTRAL';
  regime: 'TRENDING' | 'VOLATILE' | 'RANGING' | 'TRANSITIONAL';
  strategy: string;
  direction: 'CALL' | 'PUT' | 'WAIT';
  score: number;
  shock: number;
  reasons: string[];
}

const DEFAULT_FEATURES: MarketFeatures = {
  ready: false, count: 0,
  ema9: null, ema21: null, rsi: null, rsi5: null,
  volatility: 0, momentum: 0, trend: 0,
  bollingerWidth: 0, bwDelta: 0,
  volatilityState: 'NEUTRAL',
  regime: 'RANGING',
  strategy: 'CONFLUENCE', direction: 'WAIT',
  score: 50, shock: 0, reasons: [],
};

/**
 * Extract LUCAS-style features from price history.
 * Requires at least 25 price points to produce features.
 * (25 = max(EMA21, RSI14, BB20) + small buffer)
 * 
 * Returns 7 strategy types:
 *   1. POST_SPIKE_REVERSION (Boom/Crash after shock)
 *   2. DRIFT_CONTINUATION (Boom/Crash contracting trend)
 *   3. VOLATILITY_BREAKOUT (Boom/Crash expanding)
 *   4. BREAKOUT (Volatility expansion + trend)
 *   5. MEAN_REVERSION (Contracting + RSI extremes)
 *   6. TREND_CONTINUATION (Trending + aligned momentum)
 *   7. MOMENTUM_EXPANSION (Transitional + strong momentum)
 */
export function extractMarketFeatures(
  prices: number[],
  marketName: string = ''
): MarketFeatures {
  // v15.4: Lowered from 45→25 — EMA21 needs 21, RSI14 needs 14, BB20 needs 20.
  // 45-price requirement created a ~30-tick dead zone where bot scanned but couldn't signal.
  if (prices.length < 25) return { ...DEFAULT_FEATURES, count: prices.length };

  const e9 = ema(prices.slice(-100), 9);
  const e21 = ema(prices.slice(-160), 21);
  const rr = rsi(prices, 14);
  const rsi5Val = rsi(prices, 5);

  // Calculate returns for volatility
  const returns: number[] = [];
  for (let i = Math.max(1, prices.length - 41); i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / (Math.abs(prices[i - 1]) || 1));
  }
  const vol = stddev(returns);

  // Momentum: 5-tick price change normalized
  const mom = prices.length > 5
    ? (prices[prices.length - 1] - prices[prices.length - 6]) / (Math.abs(prices[prices.length - 6]) || 1)
    : 0;

  // Trend: EMA crossover normalized
  const trend = (e9 !== null && e21 !== null) ? (e9 - e21) / (Math.abs(e21) || 1) : 0;

  // Bollinger Band Width
  const bw = bollingerWidth(prices, 20) || 0;
  const bwPrev = prices.length >= 30 ? (bollingerWidth(prices.slice(0, -8), 20) || bw) : bw;
  const bwDelta = bwPrev ? ((bw - bwPrev) / Math.abs(bwPrev)) : 0;

  // v15: Relaxed BB width delta for Volatility Indices
  // R_ indices have tiny BW values so 10% delta was almost never triggered
  const isVolIndex2 = /volatility/i.test(marketName) || /^R_/i.test(marketName);
  const bwDeltaThresh = isVolIndex2 ? 0.03 : 0.10;
  const volatilityState: MarketFeatures['volatilityState'] =
    bwDelta > bwDeltaThresh ? 'EXPANDING' : bwDelta < -bwDeltaThresh ? 'CONTRACTING' : 'NEUTRAL';

  // v15: Relaxed thresholds for Volatility Indices so O/U signals actually fire
  // The old thresholds were ~100x too strict for R_ indices, causing permanent WAIT
  const isVolIndex = /volatility/i.test(marketName) || /^R_/i.test(marketName);
  const trendThresh = isVolIndex ? 0.0000008 : 0.00012;
  const volThresh = isVolIndex ? 0.0000008 : 0.0008;
  const rangeThresh = isVolIndex ? 0.0000003 : 0.00004;
  const breakoutTrendThresh = isVolIndex ? 0.0000005 : 0.00004;
  const momentumThresh = isVolIndex ? 0.00000015 : 0.000015;
  const expansionMomThresh = isVolIndex ? 0.0000005 : 0.00005;
  const driftTrendThresh = isVolIndex ? 0.0000003 : 0.00002;

  // Regime
  let regime: MarketFeatures['regime'];
  if (Math.abs(trend) > trendThresh) regime = 'TRENDING';
  else if (vol > volThresh) regime = 'VOLATILE';
  else if (Math.abs(trend) < rangeThresh) regime = 'RANGING';
  else regime = 'TRANSITIONAL';

  // Strategy detection
  const isBoom = /boom/i.test(marketName);
  const isCrash = /crash/i.test(marketName);
  const lastMove = prices.length > 2
    ? (prices[prices.length - 1] - prices[prices.length - 2]) / (Math.abs(prices[prices.length - 2]) || 1)
    : 0;

  // Shock detection
  const recentMoves: number[] = [];
  for (let i = Math.max(1, prices.length - 20); i < prices.length; i++) {
    recentMoves.push((prices[i] - prices[i - 1]) / (Math.abs(prices[i - 1]) || 1));
  }
  const recentStddev = stddev(recentMoves);
  const shock = recentStddev ? Math.abs(lastMove) / (recentStddev || 1) : 0;

  let strategy = 'CONFLUENCE';
  let direction: MarketFeatures['direction'] = 'WAIT';
  let raw = 50;

  if ((isBoom || isCrash) && shock > 3) {
    strategy = 'POST_SPIKE_REVERSION';
    direction = isBoom ? 'PUT' : 'CALL';
    raw = 60 + Math.min(30, shock * 3);
  } else if ((isBoom || isCrash) && volatilityState === 'CONTRACTING' && Math.abs(trend) > driftTrendThresh) {
    strategy = 'DRIFT_CONTINUATION';
    direction = trend > 0 ? 'CALL' : 'PUT';
    raw = 58 + Math.min(28, Math.abs(trend) * (isVolIndex ? 16000000 : 160000));
  } else if ((isBoom || isCrash) && volatilityState === 'EXPANDING') {
    strategy = 'VOLATILITY_BREAKOUT';
    direction = mom >= 0 ? 'CALL' : 'PUT';
    raw = 58 + Math.min(30, Math.abs(mom) * (isVolIndex ? 10000000 : 100000));
  } else if (volatilityState === 'EXPANDING' && Math.abs(trend) > breakoutTrendThresh) {
    strategy = 'BREAKOUT';
    direction = trend > 0 ? 'CALL' : 'PUT';
    raw = 58 + Math.min(30, Math.abs(trend) * (isVolIndex ? 18000000 : 180000)) + Math.min(12, Math.abs(mom) * (isVolIndex ? 9000000 : 90000));
  } else if (volatilityState === 'CONTRACTING' && rr !== null && (rr >= 58 || rr <= 42)) {
    // v14: Widened RSI bands (58/42 instead of 62/38) for more signals
    strategy = 'MEAN_REVERSION';
    direction = rr >= 58 ? 'PUT' : 'CALL';
    raw = 58 + Math.min(28, Math.abs(rr - 50) * 1.25);
  } else if (regime === 'TRENDING' && Math.sign(trend) === Math.sign(mom) && Math.abs(mom) > momentumThresh) {
    strategy = 'TREND_CONTINUATION';
    direction = trend > 0 ? 'CALL' : 'PUT';
    raw = 56 + Math.min(32, Math.abs(trend) * (isVolIndex ? 16000000 : 160000)) + Math.min(12, Math.abs(mom) * (isVolIndex ? 8000000 : 80000));
  } else if (regime === 'TRANSITIONAL' && Math.abs(mom) > expansionMomThresh) {
    strategy = 'MOMENTUM_EXPANSION';
    direction = mom > 0 ? 'CALL' : 'PUT';
    raw = 55 + Math.min(35, Math.abs(mom) * (isVolIndex ? 12000000 : 120000));
  } else if (regime === 'TRENDING' && Math.sign(trend) !== Math.sign(mom)) {
    // v14: Divergence detection (trend vs momentum disagree)
    strategy = 'MEAN_REVERSION';
    direction = trend > 0 ? 'PUT' : 'CALL'; // fade the trend
    raw = 54;
  }

  // v15.3: FALLBACK — if still WAIT but we have ANY momentum or trend, use it.
  // For Volatility Indices, the strict conditions above may all miss.
  // This ensures the bot always has a directional signal for O/U mapping.
  // v15.4: Match the 25-price threshold above.
  if (direction === 'WAIT' && prices.length >= 25) {
    if (Math.abs(mom) > 0) {
      // Use momentum direction as baseline signal
      strategy = 'MOMENTUM_EXPANSION';
      direction = mom > 0 ? 'CALL' : 'PUT';
      raw = 52 + Math.min(15, Math.abs(mom) * (isVolIndex ? 20000000 : 200000));
    } else if (Math.abs(trend) > 0) {
      // Use EMA trend direction
      strategy = 'TREND_CONTINUATION';
      direction = trend > 0 ? 'CALL' : 'PUT';
      raw = 52 + Math.min(15, Math.abs(trend) * (isVolIndex ? 20000000 : 200000));
    } else if (rr !== null) {
      // Use RSI as last resort
      strategy = 'MEAN_REVERSION';
      direction = rr >= 50 ? 'PUT' : 'CALL';
      raw = 51;
    }
  }

  const score = direction === 'WAIT'
    ? clamp(50 + trend * 120000 + mom * 60000, 0, 100)
    : clamp(raw, 0, 100);

  const reasons: string[] = [
    `Regime ${regime}`,
    `Volatility ${volatilityState}`,
    `BB width ${(bw * 100).toFixed(3)}%`,
  ];
  if (Math.abs(trend) > (isVolIndex ? 0.0000005 : 0.00002)) reasons.push(`EMA trend ${trend > 0 ? 'bullish' : 'bearish'}`);
  if (Math.abs(mom) > (isVolIndex ? 0.0000002 : 0.00001)) reasons.push(`Momentum ${mom > 0 ? 'positive' : 'negative'}`);
  if (rr !== null) reasons.push(`RSI ${rr.toFixed(1)}`);

  return {
    ready: true, count: prices.length,
    ema9: e9, ema21: e21, rsi: rr, rsi5: rsi5Val,
    volatility: vol, momentum: mom, trend,
    bollingerWidth: bw, bwDelta,
    volatilityState, regime, strategy, direction, score, shock, reasons,
  };
}

/**
 * Timeframe analysis — determine price direction over various windows.
 * Used for multi-timeframe display on the dashboard.
 */
export interface TimeframeResult {
  ready: boolean;
  direction: 'UP' | 'DOWN' | 'FLAT';
  move: number;
  points: number;
  label: string;
}

export function timeframeAnalysis(
  prices: number[],
  seconds: number,
  now: number,
  epochOffset: number = 0,
): TimeframeResult {
  if (!prices.length) return { ready: false, direction: 'FLAT', move: 0, points: 0, label: 'NO DATA' };

  // Approximate: assume each tick is ~1-2 seconds apart
  // For R_10, ticks come every ~2s; for R_100, every ~1s
  const approxTickIntervalMs = 2000;
  const ticksInWindow = Math.floor((seconds * 1000) / approxTickIntervalMs);
  const startIdx = Math.max(0, prices.length - ticksInWindow);
  const slice = prices.slice(startIdx);

  if (slice.length < 5) {
    return { ready: false, direction: 'FLAT', move: 0, points: slice.length, label: 'LEARNING' };
  }

  const first = slice[0];
  const last = slice[slice.length - 1];
  const move = (last - first) / (Math.abs(first) || 1);

  let direction: TimeframeResult['direction'] = 'FLAT';
  if (move > 0.0001) direction = 'UP';
  else if (move < -0.0001) direction = 'DOWN';

  const secLabel = seconds < 60 ? `${seconds}S` : seconds < 3600 ? `${seconds / 60}M` : `${seconds / 3600}H`;

  return { ready: true, direction, move, points: slice.length, label: secLabel };
}

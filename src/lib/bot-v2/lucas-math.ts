'use client';

// === LUCAS Math Utilities — Ported from LUCAS Profit Intelligence V2.3.1 ===
// Wilson lower bound, beta smoothing, EMA, RSI, Bollinger width, expected value

/** Exponential Moving Average */
export function ema(values: number[], period: number): number | null {
  if (!values.length) return null;
  const k = 2 / (period + 1);
  let out = values[0];
  for (let i = 1; i < values.length; i++) out = values[i] * k + out * (1 - k);
  return out;
}

/** Relative Strength Index */
export function rsi(values: number[], period: number = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}

/** Standard Deviation */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1));
}

/** Clamp a number between min and max */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Wilson Lower Bound — 95% confidence interval lower bound for a win rate.
 * More honest than raw win rate for small samples.
 * If we have 30 wins out of 50 trades, the Wilson LB might be ~45%
 */
export function wilsonLower(wins: number, n: number, z: number = 1.96): number {
  if (!n) return 0;
  const p = wins / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const adj = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (centre - adj) / den);
}

/**
 * Bollinger Band Width — normalized by price.
 * Measures volatility as percentage of the mean.
 */
export function bollingerWidth(values: number[], period: number = 20, mult: number = 2): number | null {
  if (values.length < period) return null;
  const rows = values.slice(-period);
  const mean = rows.reduce((a, b) => a + b, 0) / rows.length;
  const sd = stddev(rows);
  return mean ? ((mult * sd * 2) / Math.abs(mean)) : 0;
}

/**
 * Beta Smoothed probability — Bayesian prior (alpha=1, beta=1 = uniform prior)
 * Prevents extreme probabilities from small samples.
 * With 0 wins out of 0 trades: returns 0.5 (prior)
 * With 10 wins out of 10 trades: returns (10+1)/(10+2) = 0.917 (shrunk toward 0.5)
 */
export function betaSmoothed(wins: number, n: number, alpha: number = 1, beta: number = 1): number {
  return n >= 0 ? (wins + alpha) / (n + alpha + beta) : 0.5;
}

/**
 * Expected Value calculation for a trade.
 * EV = P(win) * (payout - stake) - P(loss) * stake
 * EV = P(win) * payout - stake
 */
export function expectedValue(probability: number, askPrice: number, payout: number): number | null {
  const p = clamp(Number(probability) || 0, 0, 1);
  const a = Number(askPrice) || 0;
  const po = Number(payout) || 0;
  if (a <= 0 || po <= 0) return null;
  return p * (po - a) - (1 - p) * a;
}

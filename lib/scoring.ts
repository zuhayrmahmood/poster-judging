/**
 * TypeScript mirror of the aggregation math in supabase/migrations/0002_views.sql.
 *
 * The dashboard reads the SQL views, so these helpers exist for (a) previewing a total
 * in the judge UI before submit and (b) unit tests that pin the two implementations
 * together. If you change the math here, change the views too — a silent divergence
 * makes the app disagree with itself.
 */

import type { Criterion } from "@/lib/types";

/**
 * Weighted total as a 0-100 percentage.
 *
 * Each criterion is normalized to a fraction of its own `max_score` before weighting,
 * so criteria can mix scales (1-5 alongside 1-10) and weights need not sum to 100.
 *
 * Criteria with no score are excluded from both the numerator and the denominator,
 * matching the inner join in `v_submission_totals`. A half-finished form therefore
 * reports the average of what was actually filled in, not a total dragged toward zero.
 *
 * Returns null when nothing has been scored.
 */
export function weightedPct(
  scores: Record<string, number>,
  criteria: Criterion[],
): number | null {
  let weighted = 0;
  let totalWeight = 0;

  for (const criterion of criteria) {
    const value = scores[criterion.id];
    if (value === undefined || value === null) continue;
    weighted += (value / criterion.max_score) * criterion.weight;
    totalWeight += criterion.weight;
  }

  if (totalWeight === 0) return null;
  return (100 * weighted) / totalWeight;
}

export type JudgeStats = {
  mean: number;
  /** Sample standard deviation (n-1), matching Postgres `stddev_samp`. */
  sd: number;
  n: number;
};

/** Mean and sample standard deviation of one judge's submitted totals. */
export function judgeStats(pcts: number[]): JudgeStats {
  const n = pcts.length;
  if (n === 0) return { mean: 0, sd: 0, n: 0 };

  const mean = pcts.reduce((sum, p) => sum + p, 0) / n;
  if (n < 2) return { mean, sd: 0, n };

  const variance =
    pcts.reduce((sum, p) => sum + (p - mean) ** 2, 0) / (n - 1);
  return { mean, sd: Math.sqrt(variance), n };
}

/**
 * How far above or below their own average this judge placed a poster.
 *
 * A judge who has scored fewer than two posters, or who gave every poster an identical
 * score, has no meaningful spread to normalize against. They contribute a neutral 0
 * rather than NaN, so they neither help nor hurt a poster's normalized rank.
 */
export function zScore(pct: number, stats: JudgeStats): number {
  if (stats.n < 2 || stats.sd === 0) return 0;
  return (pct - stats.mean) / stats.sd;
}

/** Average, or null for an empty list — used for a poster's cross-judge aggregate. */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

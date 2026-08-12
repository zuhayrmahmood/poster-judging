import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { judgeStats, mean, weightedPct, zScore } from "@/lib/scoring";
import type { Criterion } from "@/lib/types";

/**
 * These numbers are the same fixture used to verify supabase/migrations/0002_views.sql
 * against a real Postgres. Keeping both pinned to identical values is what stops the
 * TypeScript preview and the SQL dashboard from silently disagreeing.
 */

function criterion(id: string, weight: number, maxScore = 5): Criterion {
  return {
    id,
    event_id: "e1",
    label: id,
    description: null,
    weight,
    max_score: maxScore,
    sort_order: 0,
  };
}

const RUBRIC = [
  criterion("research", 30),
  criterion("visual", 20),
  criterion("oral", 30),
  criterion("qa", 20),
];

const close = (actual: number | null, expected: number, tolerance = 1e-4) => {
  assert.notEqual(actual, null);
  assert.ok(
    Math.abs((actual as number) - expected) < tolerance,
    `expected ${expected}, got ${actual}`,
  );
};

describe("weightedPct", () => {
  it("matches the SQL fixture totals", () => {
    close(weightedPct({ research: 5, visual: 4, oral: 5, qa: 4 }, RUBRIC), 92);
    close(weightedPct({ research: 3, visual: 3, oral: 3, qa: 3 }, RUBRIC), 60);
    close(weightedPct({ research: 4, visual: 4, oral: 4, qa: 4 }, RUBRIC), 80);
    close(weightedPct({ research: 5, visual: 4, oral: 3, qa: 2 }, RUBRIC), 72);
  });

  it("returns 100 for a perfect sheet and 0 for an all-zero sheet", () => {
    close(weightedPct({ research: 5, visual: 5, oral: 5, qa: 5 }, RUBRIC), 100);
    close(weightedPct({ research: 0, visual: 0, oral: 0, qa: 0 }, RUBRIC), 0);
  });

  it("excludes unscored criteria from both numerator and denominator", () => {
    // Only one criterion answered, at full marks: the sheet reads 100%, not 30%.
    // This mirrors the inner join in v_submission_totals.
    close(weightedPct({ research: 5 }, RUBRIC), 100);
    close(weightedPct({ research: 4 }, RUBRIC), 80);
    // Two criteria, different weights, both at 50%.
    close(weightedPct({ research: 2.5, visual: 2.5 }, RUBRIC), 50);
  });

  it("handles criteria with different max scores", () => {
    const mixed = [criterion("five", 50, 5), criterion("ten", 50, 10)];
    // 5/5 and 5/10 -> (100% * 50 + 50% * 50) / 100 = 75%
    close(weightedPct({ five: 5, ten: 5 }, mixed), 75);
  });

  it("returns null when nothing has been scored", () => {
    assert.equal(weightedPct({}, RUBRIC), null);
    assert.equal(weightedPct({ unknown: 4 }, RUBRIC), null);
    assert.equal(weightedPct({ research: 4 }, []), null);
  });
});

describe("judgeStats", () => {
  it("matches Postgres avg and stddev_samp on the fixture", () => {
    const j1 = judgeStats([92, 60, 80]);
    close(j1.mean, 77.3333);
    close(j1.sd, 16.1658);
    assert.equal(j1.n, 3);

    const j2 = judgeStats([80, 40, 100]);
    close(j2.mean, 73.3333);
    close(j2.sd, 30.5505);
    assert.equal(j2.n, 3);
  });

  it("reports no spread for a single submission", () => {
    const stats = judgeStats([100]);
    assert.equal(stats.n, 1);
    assert.equal(stats.sd, 0);
    close(stats.mean, 100);
  });

  it("handles an empty list", () => {
    assert.deepEqual(judgeStats([]), { mean: 0, sd: 0, n: 0 });
  });
});

describe("zScore", () => {
  it("scales by the judge's own spread", () => {
    close(zScore(92, judgeStats([92, 60, 80])), 0.907266);
    close(zScore(60, judgeStats([92, 60, 80])), -1.072222);
    close(zScore(80, judgeStats([80, 40, 100])), 0.218218);
  });

  it("is neutral for a judge with fewer than two submissions", () => {
    // The case that would otherwise be NaN and poison every poster they touched.
    assert.equal(zScore(100, judgeStats([100])), 0);
    assert.equal(zScore(100, judgeStats([])), 0);
  });

  it("is neutral for a judge who scored everything identically", () => {
    assert.equal(zScore(70, judgeStats([70, 70, 70])), 0);
  });
});

describe("poster aggregate", () => {
  it("reproduces the fixture's ranking, including the harsh/lenient correction", () => {
    const j1 = judgeStats([92, 60, 80]);
    const j2 = judgeStats([80, 40, 100]);
    const j3 = judgeStats([100]); // single submission -> contributes 0

    // A-01 was scored 92 / 80 / 100.
    close(mean([92, 80, 100]), 90.6667);
    close(mean([zScore(92, j1), zScore(80, j2), zScore(100, j3)]), 0.37517);

    // A-03 was scored 80 / 100 by two judges.
    close(mean([80, 100]), 90);
    close(mean([zScore(80, j1), zScore(100, j2)]), 0.51891);

    // The point of normalizing: A-03 has the lower raw average but the higher
    // normalized score, because A-01's 100 came from a judge with no usable spread.
    assert.ok((mean([80, 100]) as number) < (mean([92, 80, 100]) as number));
    assert.ok(
      (mean([zScore(80, j1), zScore(100, j2)]) as number) >
        (mean([zScore(92, j1), zScore(80, j2), zScore(100, j3)]) as number),
    );
  });

  it("returns null for a poster nobody has judged", () => {
    // v_poster_results must emit NULL here, not 0, or unjudged posters sort mid-table.
    assert.equal(mean([]), null);
  });
});

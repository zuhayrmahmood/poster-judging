import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { judgeStats, mean, roundTo, weightedPct, zScore } from "@/lib/scoring";
import type { Criterion } from "@/lib/types";

/**
 * Pins supabase/migrations/0002_views.sql to lib/scoring.ts.
 *
 * The judge UI previews a total with the TypeScript in lib/scoring.ts; the dashboard
 * reads the SQL views. Nothing but this test stops the two from silently disagreeing.
 * tests/scoring.test.ts pins the TypeScript to a fixed fixture — this runs the *same*
 * shape of fixture through real Postgres and asserts the two agree to the last decimal
 * the views round to.
 *
 * Also covers the parts of 0003_save_submission.sql that the offline outbox depends on:
 * a replayed submission must overwrite rather than double-count.
 */

// 0004 is deliberately absent: it needs Supabase's `auth` schema and its anon /
// authenticated roles, neither of which exists here. Every other migration is portable
// and belongs in this list, so the fixture keeps matching the real schema.
const MIGRATIONS = [
  "0001_init",
  "0002_views",
  "0003_save_submission",
  "0005_login_attempts_by_code",
];

const RUBRIC: Array<{ label: string; weight: number; max: number }> = [
  { label: "research", weight: 30, max: 5 },
  { label: "visual", weight: 20, max: 5 },
  { label: "oral", weight: 30, max: 5 },
  { label: "qa", weight: 20, max: 5 },
];

/** Judge -> poster -> raw criterion values, in RUBRIC order. */
const SHEETS: Record<string, Record<string, number[]>> = {
  // Spread across three posters, so this judge has a usable standard deviation.
  A: { P1: [5, 4, 5, 4], P2: [3, 3, 3, 3], P3: [4, 4, 4, 4] },
  // Identical scores: sd = 0, so this judge must contribute a neutral 0 to norm_z.
  B: { P1: [4, 4, 4, 4], P2: [4, 4, 4, 4] },
  // A single submission: n < 2, also neutral.
  C: { P1: [5, 4, 3, 2] },
};

// P4 appears in no sheet: it must come back unranked (null), not zero.
const POSTERS = ["P1", "P2", "P3", "P4"];

let db: PGlite;
const criterionId: Record<string, string> = {};
const posterId: Record<string, string> = {};
const judgeId: Record<string, string> = {};
let eventId: string;

before(async () => {
  db = new PGlite();
  for (const name of MIGRATIONS) {
    await db.exec(readFileSync(`supabase/migrations/${name}.sql`, "utf8"));
  }

  const ev = await db.query<{ id: string }>(
    "insert into events (name, slug, status) values ('Fixture','fixture','active') returning id",
  );
  eventId = ev.rows[0].id;

  for (const [i, c] of RUBRIC.entries()) {
    const r = await db.query<{ id: string }>(
      `insert into criteria (event_id, label, weight, max_score, sort_order)
       values ($1,$2,$3,$4,$5) returning id`,
      [eventId, c.label, c.weight, c.max, i],
    );
    criterionId[c.label] = r.rows[0].id;
  }

  for (const code of POSTERS) {
    const r = await db.query<{ id: string }>(
      "insert into posters (event_id, code, title) values ($1,$2,$3) returning id",
      [eventId, code, `Poster ${code}`],
    );
    posterId[code] = r.rows[0].id;
  }

  for (const name of Object.keys(SHEETS)) {
    const r = await db.query<{ id: string }>(
      `insert into judges (event_id, name, code_hash, code_hint)
       values ($1,$2,$3,'0000') returning id`,
      [eventId, name, `hash-${name}`],
    );
    judgeId[name] = r.rows[0].id;
  }

  for (const [judge, sheets] of Object.entries(SHEETS)) {
    for (const [poster, values] of Object.entries(sheets)) {
      await save(judgeId[judge], posterId[poster], scoresFor(values));
    }
  }
});

after(async () => {
  await db.close();
});

function scoresFor(values: number[]): Record<string, number> {
  return Object.fromEntries(
    RUBRIC.map((c, i) => [criterionId[c.label], values[i]]),
  );
}

function save(
  judge: string,
  poster: string,
  scores: Record<string, number>,
  status: "draft" | "submitted" = "submitted",
) {
  return db.query("select save_submission($1,$2,$3,$4,$5::jsonb)", [
    judge,
    poster,
    status,
    "",
    JSON.stringify(scores),
  ]);
}

/** The rubric as lib/scoring.ts wants it, with the ids the database actually assigned. */
function tsCriteria(): Criterion[] {
  return RUBRIC.map((c, i) => ({
    id: criterionId[c.label],
    event_id: eventId,
    label: c.label,
    description: null,
    weight: c.weight,
    max_score: c.max,
    sort_order: i,
  }));
}

/** The whole dashboard table, recomputed in TypeScript from the same fixture. */
function expectedResults() {
  const criteria = tsCriteria();

  const pctByJudge: Record<string, Record<string, number>> = {};
  for (const [judge, sheets] of Object.entries(SHEETS)) {
    pctByJudge[judge] = {};
    for (const [poster, values] of Object.entries(sheets)) {
      pctByJudge[judge][poster] = weightedPct(scoresFor(values), criteria)!;
    }
  }

  const stats = Object.fromEntries(
    Object.entries(pctByJudge).map(([judge, byPoster]) => [
      judge,
      judgeStats(Object.values(byPoster)),
    ]),
  );

  return Object.fromEntries(
    POSTERS.map((poster) => {
      const judges = Object.keys(SHEETS).filter((j) => poster in pctByJudge[j]);
      const raw = mean(judges.map((j) => pctByJudge[j][poster]));
      const norm = mean(
        judges.map((j) => zScore(pctByJudge[j][poster], stats[j])),
      );
      return [
        poster,
        {
          n_judges: judges.length,
          raw_pct: raw === null ? null : roundTo(raw, 2),
          norm_z: norm === null ? null : roundTo(norm, 3),
        },
      ];
    }),
  );
}

type ResultRow = {
  code: string;
  n_judges: number;
  raw_pct: string | null;
  norm_z: string | null;
};

async function sqlResults() {
  const { rows } = await db.query<ResultRow>(
    "select code, n_judges, raw_pct, norm_z from v_poster_results order by code",
  );
  return rows;
}

describe("v_poster_results matches lib/scoring.ts", () => {
  it("agrees on every poster, to the precision the view rounds to", async () => {
    const expected = expectedResults();

    for (const row of await sqlResults()) {
      const want = expected[row.code];
      assert.equal(Number(row.n_judges), want.n_judges, `${row.code} n_judges`);
      assert.equal(
        row.raw_pct === null ? null : Number(row.raw_pct),
        want.raw_pct,
        `${row.code} raw_pct`,
      );
      assert.equal(
        row.norm_z === null ? null : Number(row.norm_z),
        want.norm_z,
        `${row.code} norm_z`,
      );
    }
  });

  it("leaves an unjudged poster unranked rather than zero", async () => {
    const p4 = (await sqlResults()).find((r) => r.code === "P4")!;
    assert.equal(Number(p4.n_judges), 0);
    assert.equal(p4.raw_pct, null);
    // Not 0: a zero would sort P4 into the middle of the normalized ranking as though
    // it were an average poster.
    assert.equal(p4.norm_z, null);
  });

  it("treats a judge with no spread as neutral, not NaN", async () => {
    const { rows } = await db.query<{ sd_pct: string | null; n: number }>(
      "select sd_pct, n from v_judge_stats where judge_id = $1",
      [judgeId.B],
    );
    assert.equal(Number(rows[0].sd_pct), 0);

    // B scored P1 identically to P2, so B must move P1's norm_z by exactly nothing.
    const p1 = (await sqlResults()).find((r) => r.code === "P1")!;
    assert.equal(Number(p1.norm_z), expectedResults().P1.norm_z);
  });
});

describe("save_submission", () => {
  it("is idempotent, so a replayed outbox item overwrites", async () => {
    const scores = scoresFor(SHEETS.A.P1);
    await save(judgeId.A, posterId.P1, scores);
    await save(judgeId.A, posterId.P1, scores);

    const { rows } = await db.query<{ subs: number; scores: number }>(
      `select (select count(*) from submissions
                where judge_id=$1 and poster_id=$2) as subs,
              (select count(*) from submission_scores ss
                 join submissions s on s.id = ss.submission_id
                where s.judge_id=$1 and s.poster_id=$2) as scores`,
      [judgeId.A, posterId.P1],
    );
    assert.equal(Number(rows[0].subs), 1);
    assert.equal(Number(rows[0].scores), RUBRIC.length);
  });

  it("preserves the original submitted_at across an edit", async () => {
    const first = await db.query<{ submitted_at: Date }>(
      "select submitted_at from submissions where judge_id=$1 and poster_id=$2",
      [judgeId.A, posterId.P3],
    );
    await save(judgeId.A, posterId.P3, scoresFor([5, 5, 5, 5]));
    const second = await db.query<{ submitted_at: Date }>(
      "select submitted_at from submissions where judge_id=$1 and poster_id=$2",
      [judgeId.A, posterId.P3],
    );
    assert.deepEqual(second.rows[0].submitted_at, first.rows[0].submitted_at);
    // Restore the fixture for any test that runs after this one.
    await save(judgeId.A, posterId.P3, scoresFor(SHEETS.A.P3));
  });

  it("clamps out-of-range values and ignores non-uuid keys", async () => {
    await save(judgeId.C, posterId.P2, {
      [criterionId.research]: 99,
      [criterionId.visual]: -5,
      "not-a-uuid": 3,
    } as Record<string, number>);

    const { rows } = await db.query<{ value: number }>(
      `select ss.value from submission_scores ss
         join submissions s on s.id = ss.submission_id
        where s.judge_id=$1 and s.poster_id=$2 order by ss.value`,
      [judgeId.C, posterId.P2],
    );
    assert.deepEqual(rows.map((r) => Number(r.value)), [0, 5]);

    await db.query(
      "delete from submissions where judge_id=$1 and poster_id=$2",
      [judgeId.C, posterId.P2],
    );
  });

  it("refuses a poster from another event", async () => {
    const other = await db.query<{ id: string }>(
      "insert into events (name, slug) values ('Other','other') returning id",
    );
    const foreign = await db.query<{ id: string }>(
      "insert into posters (event_id, code, title) values ($1,'X1','Foreign') returning id",
      [other.rows[0].id],
    );

    await assert.rejects(
      () => save(judgeId.A, foreign.rows[0].id, scoresFor([1, 1, 1, 1])),
      /poster_not_in_event/,
    );
  });

  it("refuses to write once judging is closed", async () => {
    await db.query("update events set status='locked' where id=$1", [eventId]);
    await assert.rejects(
      () => save(judgeId.A, posterId.P1, scoresFor([1, 1, 1, 1])),
      /event_not_active/,
    );
    await db.query("update events set status='active' where id=$1", [eventId]);
  });

  it("refuses an unknown or deactivated judge", async () => {
    await assert.rejects(
      () =>
        save(
          "00000000-0000-0000-0000-000000000000",
          posterId.P1,
          scoresFor([1, 1, 1, 1]),
        ),
      /judge_not_found/,
    );

    await db.query("update judges set active=false where id=$1", [judgeId.C]);
    await assert.rejects(
      () => save(judgeId.C, posterId.P1, scoresFor([1, 1, 1, 1])),
      /judge_not_found/,
    );
    await db.query("update judges set active=true where id=$1", [judgeId.C]);
  });
});

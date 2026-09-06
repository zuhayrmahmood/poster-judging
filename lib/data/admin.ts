import "server-only";

import { num, numOr, one, query } from "@/lib/db";
import {
  SELECT_OWNED_POSTER,
  SELECT_OWNED_POSTER_SHEETS,
  SELECT_PRIMARY_EVENT_FOR_ADMIN,
} from "@/lib/sql/scoped";
import type {
  Criterion,
  Event,
  Judge,
  Poster,
  PosterResult,
} from "@/lib/types";

/**
 * Admin reads.
 *
 * The `eventId`-taking functions below do no authorization of their own — callers must
 * have passed `requireEventScope(eventId)` first, which proves the caller belongs to an
 * organisation that owns that event. The functions taking a bare child id *do* scope
 * themselves, because there is no event in the signature for a caller to have checked.
 */

const JUDGE_COLUMNS = "id, event_id, name, email, code_hint, active, created_at";

/**
 * The event the dashboard shows, scoped to whoever is asking. The schema is
 * multi-event, but the UI is still one-event-at-a-time: prefer the active one, else the
 * most recently created, among the events this admin's organisations own.
 */
export async function getPrimaryEventForAdmin(adminId: string): Promise<Event | null> {
  return one<Event>(SELECT_PRIMARY_EVENT_FOR_ADMIN, [adminId]);
}

/**
 * One event by id, with **no** authorization of its own — the caller must already have
 * proven access to it, either through `requireEventScope` or by having loaded a row
 * that belongs to it via an ownership-scoped query.
 */
export async function getEventById(eventId: string): Promise<Event | null> {
  return one<Event>("select * from events where id = $1", [eventId]);
}

export type RankedResult = PosterResult & { rank: number };

/** `numeric` columns arrive as strings; the ranking below sorts on them. */
function toResult(row: PosterResult): PosterResult {
  return {
    ...row,
    n_judges: numOr(row.n_judges),
    raw_pct: num(row.raw_pct),
    norm_z: num(row.norm_z),
  };
}

/**
 * Poster results, ranked. Sorting happens here rather than in SQL so the dashboard can
 * flip between the raw and normalized orderings without a round trip.
 *
 * Posters nobody has judged (`raw_pct` null) always sort last, whichever mode is
 * active — they have no score, which is different from a score of zero.
 */
export async function getResults(
  eventId: string,
  mode: "raw" | "normalized" = "raw",
): Promise<RankedResult[]> {
  const rows = (
    await query<PosterResult>("select * from v_poster_results where event_id = $1", [
      eventId,
    ])
  ).map(toResult);

  const key = mode === "raw" ? "raw_pct" : "norm_z";

  const sorted = [...rows].sort((a, b) => {
    const aVal = a[key];
    const bVal = b[key];
    if (aVal === null && bVal === null) return a.code.localeCompare(b.code);
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    if (aVal !== bVal) return bVal - aVal;
    return a.code.localeCompare(b.code);
  });

  return sorted.map((row, index) => ({ ...row, rank: index + 1 }));
}

export type JudgeProgress = {
  judge_id: string;
  name: string;
  code_hint: string;
  active: boolean;
  assigned: number;
  submitted: number;
};

export async function getJudgeProgress(eventId: string): Promise<JudgeProgress[]> {
  const rows = await query<JudgeProgress>(
    "select * from v_judge_progress where event_id = $1 order by name",
    [eventId],
  );
  // `count(...)` is bigint, which is not safely a JS number in general — at this scale
  // it always is, but coerce rather than leave the type a lie.
  return rows.map((row) => ({
    ...row,
    assigned: numOr(row.assigned),
    submitted: numOr(row.submitted),
  }));
}

export async function getPosters(eventId: string): Promise<Poster[]> {
  return query<Poster>(
    "select * from posters where event_id = $1 order by location, code",
    [eventId],
  );
}

export async function getJudges(eventId: string): Promise<Judge[]> {
  return query<Judge>(
    `select ${JUDGE_COLUMNS} from judges where event_id = $1 order by name`,
    [eventId],
  );
}

export async function getCriteria(eventId: string): Promise<Criterion[]> {
  const rows = await query<Criterion>(
    "select * from criteria where event_id = $1 order by sort_order, label",
    [eventId],
  );
  return rows.map((row) => ({ ...row, weight: numOr(row.weight) }));
}

export type PosterSheet = {
  judgeId: string;
  judgeName: string;
  pct: number | null;
  comment: string | null;
  submittedAt: string | null;
  scores: Record<string, number>;
};

/**
 * Every judge's sheet for one poster, for the drill-down view.
 *
 * Scoped by admin rather than by event: the caller passes a bare poster id, so there is
 * no event for them to have checked. Unscoped, this returned any event's full per-judge
 * scores and comments to any signed-in organiser who could produce a poster UUID.
 */
export async function getPosterSheets(
  posterId: string,
  adminId: string,
): Promise<PosterSheet[]> {
  type Row = {
    submission_id: string;
    judge_id: string;
    judge_name: string | null;
    comment: string | null;
    submitted_at: string | null;
    pct: string | null;
    // Aggregated in SQL rather than fetched as a second query and stitched in JS.
    scores: Record<string, number> | null;
  };

  const rows = await query<Row>(SELECT_OWNED_POSTER_SHEETS, [posterId, adminId]);

  return rows.map((row) => ({
    judgeId: row.judge_id,
    judgeName: row.judge_name ?? "Unknown judge",
    pct: num(row.pct),
    comment: row.comment,
    submittedAt: row.submitted_at,
    scores: Object.fromEntries(
      Object.entries(row.scores ?? {}).map(([id, value]) => [id, Number(value)]),
    ),
  }));
}

/**
 * One poster, ownership-checked. Same reasoning as `getPosterSheets`: a bare poster id
 * carries no event for the caller to have proven, so the check happens here.
 */
export async function getOwnedPoster(
  posterId: string,
  adminId: string,
): Promise<Poster | null> {
  return one<Poster>(SELECT_OWNED_POSTER, [posterId, adminId]);
}

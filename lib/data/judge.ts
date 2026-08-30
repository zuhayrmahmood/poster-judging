import "server-only";

import { num, one, query } from "@/lib/db";
import type {
  AssignmentRow,
  Criterion,
  Event,
  Judge,
  Poster,
  Submission,
} from "@/lib/types";

/** Read helpers for the judge-facing pages. Every caller must already hold a session. */

const JUDGE_COLUMNS = "id, event_id, name, email, code_hint, active, created_at";

export async function getEvent(eventId: string): Promise<Event | null> {
  return one<Event>("select * from events where id = $1", [eventId]);
}

export async function getJudge(judgeId: string): Promise<Judge | null> {
  return one<Judge>(`select ${JUDGE_COLUMNS} from judges where id = $1`, [judgeId]);
}

export async function getCriteria(eventId: string): Promise<Criterion[]> {
  const rows = await query<Criterion>(
    "select * from criteria where event_id = $1 order by sort_order, label",
    [eventId],
  );
  // `weight` is numeric, so it arrives as a string; the scoring math would concatenate
  // rather than add if it stayed that way.
  return rows.map((row) => ({ ...row, weight: num(row.weight) ?? 0 }));
}

/**
 * The judge's list, in walking order, annotated with what they have already done.
 *
 * A left join rather than two queries: with the poster row and the submission state in
 * one result, "not_started" is just a null status, and the walking order comes straight
 * from the index on (judge_id, sort_order).
 */
export async function getAssignmentRows(judgeId: string): Promise<AssignmentRow[]> {
  type Row = Poster & {
    submission_status: AssignmentRow["status"] | null;
    submission_updated_at: string | null;
  };

  const rows = await query<Row>(
    `select p.*,
            s.status     as submission_status,
            s.updated_at as submission_updated_at
       from assignments a
       join posters p on p.id = a.poster_id
       left join submissions s
              on s.poster_id = a.poster_id
             and s.judge_id  = a.judge_id
      where a.judge_id = $1
      order by a.sort_order`,
    [judgeId],
  );

  return rows.map(({ submission_status, submission_updated_at, ...poster }) => ({
    poster,
    status: submission_status ?? "not_started",
    updated_at: submission_updated_at,
  }));
}

/**
 * Scoped to the judge's event on purpose: this is the boundary that stops a crafted
 * poster id from another event reaching the scoring form.
 */
export async function getPosterInEvent(
  posterId: string,
  eventId: string,
): Promise<Poster | null> {
  return one<Poster>(
    "select * from posters where id = $1 and event_id = $2",
    [posterId, eventId],
  );
}

export type SubmissionWithScores = {
  submission: Submission;
  scores: Record<string, number>;
};

export async function getSubmission(
  judgeId: string,
  posterId: string,
): Promise<SubmissionWithScores | null> {
  const submission = await one<Submission>(
    "select * from submissions where judge_id = $1 and poster_id = $2",
    [judgeId, posterId],
  );
  if (!submission) return null;

  const rows = await query<{ criterion_id: string; value: number }>(
    "select criterion_id, value from submission_scores where submission_id = $1",
    [submission.id],
  );

  const scores: Record<string, number> = {};
  for (const row of rows) scores[row.criterion_id] = Number(row.value);

  return { submission, scores };
}

/**
 * The "search all posters" fallback for a judge who has wandered off their assigned
 * aisle. Matches on poster code or title.
 */
export async function searchPosters(
  eventId: string,
  term: string,
): Promise<Poster[]> {
  const trimmed = term.trim();

  if (!trimmed) {
    return query<Poster>(
      "select * from posters where event_id = $1 order by location, code limit 50",
      [eventId],
    );
  }

  // The term is a bound parameter, so `%` and `_` are the only characters with meaning
  // and they only ever widen the match. No escaping dance is needed here — unlike the
  // PostgREST `or=` filter this replaces, where a comma changed the filter's structure.
  return query<Poster>(
    `select * from posters
      where event_id = $1
        and (code ilike $2 or title ilike $2)
      order by location, code
      limit 50`,
    [eventId, `%${trimmed}%`],
  );
}

/** Progress counter for the assignment list header. */
export function countSubmitted(rows: AssignmentRow[]): number {
  return rows.filter((row) => row.status === "submitted").length;
}

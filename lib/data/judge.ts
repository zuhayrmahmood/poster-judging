import "server-only";

import { db } from "@/lib/supabase/admin";
import type {
  AssignmentRow,
  Criterion,
  Event,
  Judge,
  Poster,
  Submission,
} from "@/lib/types";

/** Read helpers for the judge-facing pages. Every caller must already hold a session. */

export async function getEvent(eventId: string): Promise<Event | null> {
  const { data } = await db().from("events").select("*").eq("id", eventId).single();
  return data;
}

export async function getJudge(judgeId: string): Promise<Judge | null> {
  const { data } = await db()
    .from("judges")
    .select("id, event_id, name, email, code_hint, active, created_at")
    .eq("id", judgeId)
    .single();
  return data;
}

export async function getCriteria(eventId: string): Promise<Criterion[]> {
  const { data } = await db()
    .from("criteria")
    .select("*")
    .eq("event_id", eventId)
    .order("sort_order")
    .order("label");
  return data ?? [];
}

/**
 * The judge's list, in walking order, annotated with what they have already done.
 *
 * Two queries rather than one join: the submission for a poster may not exist, and
 * merging in JS keeps the "not_started" case explicit instead of leaning on a null from
 * an outer join.
 */
export async function getAssignmentRows(judgeId: string): Promise<AssignmentRow[]> {
  const { data: assignments } = await db()
    .from("assignments")
    .select("sort_order, poster:posters(*)")
    .eq("judge_id", judgeId)
    .order("sort_order");

  if (!assignments) return [];

  const { data: submissions } = await db()
    .from("submissions")
    .select("poster_id, status, updated_at")
    .eq("judge_id", judgeId);

  const byPoster = new Map(
    (submissions ?? []).map((s) => [s.poster_id, s] as const),
  );

  return assignments.flatMap((row) => {
    // Supabase types an embedded to-one relation as an array; unwrap it.
    const poster = (Array.isArray(row.poster) ? row.poster[0] : row.poster) as
      | Poster
      | undefined;
    if (!poster) return [];

    const submission = byPoster.get(poster.id);
    return [
      {
        poster,
        status: submission?.status ?? "not_started",
        updated_at: submission?.updated_at ?? null,
      } satisfies AssignmentRow,
    ];
  });
}

/**
 * Scoped to the judge's event on purpose: this is the boundary that stops a crafted
 * poster id from another event reaching the scoring form.
 */
export async function getPosterInEvent(
  posterId: string,
  eventId: string,
): Promise<Poster | null> {
  const { data } = await db()
    .from("posters")
    .select("*")
    .eq("id", posterId)
    .eq("event_id", eventId)
    .single();
  return data;
}

export type SubmissionWithScores = {
  submission: Submission;
  scores: Record<string, number>;
};

export async function getSubmission(
  judgeId: string,
  posterId: string,
): Promise<SubmissionWithScores | null> {
  const { data: submission } = await db()
    .from("submissions")
    .select("*")
    .eq("judge_id", judgeId)
    .eq("poster_id", posterId)
    .maybeSingle();

  if (!submission) return null;

  const { data: rows } = await db()
    .from("submission_scores")
    .select("criterion_id, value")
    .eq("submission_id", submission.id);

  const scores: Record<string, number> = {};
  for (const row of rows ?? []) scores[row.criterion_id] = row.value;

  return { submission, scores };
}

/**
 * The "search all posters" fallback for a judge who has wandered off their assigned
 * aisle. Matches on poster code or title.
 */
export async function searchPosters(
  eventId: string,
  query: string,
): Promise<Poster[]> {
  const trimmed = query.trim();
  let request = db().from("posters").select("*").eq("event_id", eventId);

  if (trimmed) {
    // Escape PostgREST's `or` delimiters so a comma or paren in the query cannot
    // change the filter's structure.
    const safe = trimmed.replace(/[(),]/g, " ");
    request = request.or(`code.ilike.%${safe}%,title.ilike.%${safe}%`);
  }

  const { data } = await request.order("location").order("code").limit(50);
  return data ?? [];
}

/** Progress counter for the assignment list header. */
export function countSubmitted(rows: AssignmentRow[]): number {
  return rows.filter((row) => row.status === "submitted").length;
}

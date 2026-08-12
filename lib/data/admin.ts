import "server-only";

import { db } from "@/lib/supabase/admin";
import type {
  Criterion,
  Event,
  Judge,
  Poster,
  PosterResult,
} from "@/lib/types";

/**
 * Admin reads. Callers must have passed `requireAdmin()` first — nothing here checks.
 */

/**
 * The event the dashboard shows. The schema is multi-event, but the UI assumes one at a
 * time: prefer the active one, else the most recently created.
 */
export async function getPrimaryEvent(): Promise<Event | null> {
  const { data: active } = await db()
    .from("events")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (active) return active;

  const { data: latest } = await db()
    .from("events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return latest;
}

export type RankedResult = PosterResult & { rank: number };

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
  const { data } = await db()
    .from("v_poster_results")
    .select("*")
    .eq("event_id", eventId);

  const rows = (data ?? []) as PosterResult[];
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
  const { data } = await db()
    .from("v_judge_progress")
    .select("*")
    .eq("event_id", eventId)
    .order("name");
  return (data ?? []) as JudgeProgress[];
}

export async function getPosters(eventId: string): Promise<Poster[]> {
  const { data } = await db()
    .from("posters")
    .select("*")
    .eq("event_id", eventId)
    .order("location")
    .order("code");
  return data ?? [];
}

export async function getJudges(eventId: string): Promise<Judge[]> {
  const { data } = await db()
    .from("judges")
    .select("id, event_id, name, email, code_hint, active, created_at")
    .eq("event_id", eventId)
    .order("name");
  return data ?? [];
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

export type PosterSheet = {
  judgeId: string;
  judgeName: string;
  pct: number | null;
  comment: string | null;
  submittedAt: string | null;
  scores: Record<string, number>;
};

/** Every judge's sheet for one poster, for the drill-down view. */
export async function getPosterSheets(posterId: string): Promise<PosterSheet[]> {
  const { data: submissions } = await db()
    .from("submissions")
    .select("id, judge_id, comment, submitted_at, judges(name)")
    .eq("poster_id", posterId)
    .eq("status", "submitted");

  if (!submissions || submissions.length === 0) return [];

  const ids = submissions.map((s) => s.id);

  const [{ data: scoreRows }, { data: totals }] = await Promise.all([
    db().from("submission_scores").select("*").in("submission_id", ids),
    db().from("v_submission_totals").select("submission_id, pct").in("submission_id", ids),
  ]);

  const pctBySubmission = new Map(
    (totals ?? []).map((t) => [t.submission_id, Number(t.pct)] as const),
  );

  return submissions
    .map((submission) => {
      const judge = Array.isArray(submission.judges)
        ? submission.judges[0]
        : submission.judges;

      const scores: Record<string, number> = {};
      for (const row of scoreRows ?? []) {
        if (row.submission_id === submission.id) scores[row.criterion_id] = row.value;
      }

      return {
        judgeId: submission.judge_id,
        judgeName: (judge as { name?: string } | null)?.name ?? "Unknown judge",
        pct: pctBySubmission.get(submission.id) ?? null,
        comment: submission.comment,
        submittedAt: submission.submitted_at,
        scores,
      };
    })
    .sort((a, b) => a.judgeName.localeCompare(b.judgeName));
}

export async function getPoster(posterId: string): Promise<Poster | null> {
  const { data } = await db().from("posters").select("*").eq("id", posterId).single();
  return data;
}

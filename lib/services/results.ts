import "server-only";

import { getJudgeProgress, getResults, type RankedResult } from "@/lib/data/admin";
import type { JudgeProgress } from "@/lib/data/admin";

import { notFound, ok, type Actor, type ServiceResult } from "./result";
import { getEventScope } from "./scope";

/**
 * Read-side services for the dashboard numbers.
 *
 * The arithmetic itself stays in `0002_views.sql` and is reached through
 * `lib/data/admin.ts`; all this adds is the ownership check those reads deliberately do
 * not perform. Ranking happens in TypeScript (see `getResults`) so the caller can flip
 * between raw and normalized ordering without another round trip.
 */

export type ResultsMode = "raw" | "normalized";

export async function listResults(
  actor: Actor,
  eventId: string,
  mode: ResultsMode,
): Promise<ServiceResult<RankedResult[]>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  return ok(await getResults(eventId, mode));
}

export async function listJudgeProgress(
  actor: Actor,
  eventId: string,
): Promise<ServiceResult<JudgeProgress[]>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  return ok(await getJudgeProgress(eventId));
}

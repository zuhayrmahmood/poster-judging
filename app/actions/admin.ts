"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/admin";
import * as assignments from "@/lib/services/assignments";
import * as criteria from "@/lib/services/criteria";
import * as events from "@/lib/services/events";
import * as judges from "@/lib/services/judges";
import * as posters from "@/lib/services/posters";
import { createServerSupabase } from "@/lib/supabase/server";
import type { EventStatus } from "@/lib/types";

export type { PosterInput } from "@/lib/services/posters";
export type { CriterionInput } from "@/lib/services/criteria";

/**
 * Server Actions are the browser's transport into the backend. Each one does three
 * things and no more: resolve who is calling, hand the work to a service, and
 * invalidate the affected paths.
 *
 * Authorization is *not* here. It lives in lib/services/*, which every transport shares
 * — so a Route Handler added later cannot become a second, subtly different answer to
 * "who may touch this". `requireAdmin()` below only establishes identity; the service
 * proves ownership of whatever id it was handed.
 *
 * These are reachable by direct POST without passing through proxy.ts, so nothing may
 * assume the UI is what called it.
 */

/**
 * Routes are event-scoped now, so every revalidation needs the event id in the path.
 *
 * These fail *silently* when wrong — the write lands and the page simply never
 * refreshes — so they are built here from one place rather than typed out at each of
 * the eighteen call sites. Actions that hold only a child id get their event from the
 * service result, which took it from the row the ownership join already proved.
 */
function eventPath(eventId: string, tab?: string) {
  const base = `/admin/events/${eventId}`;
  return tab ? `${base}/${tab}` : base;
}

export async function adminSignOut() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

export async function createEvent(orgId: string, name: string) {
  const admin = await requireAdmin();

  const result = await events.createEvent(admin, orgId, name);
  if (!result.ok) return { error: result.message };

  // The picker is what lists it; there is no event route to revalidate yet.
  revalidatePath("/admin/events");
  return { error: null };
}

export async function renameEvent(eventId: string, name: string) {
  const admin = await requireAdmin();

  const result = await events.renameEvent(admin, eventId, name);
  if (!result.ok) return { error: result.message };

  // "layout" because the name and status live in the event layout's header, above
  // whichever tab is showing.
  revalidatePath(eventPath(eventId), "layout");
  revalidatePath("/admin/events");
  return { error: null };
}

export async function setEventStatus(eventId: string, status: EventStatus) {
  const admin = await requireAdmin();

  const result = await events.setStatus(admin, eventId, status);
  if (!result.ok) return { error: result.message };

  revalidatePath(eventPath(eventId), "layout");
  revalidatePath("/admin/events");
  return { error: null };
}

export async function setTargetJudges(eventId: string, target: number) {
  const admin = await requireAdmin();

  const result = await events.setTargetJudges(admin, eventId, target);
  if (!result.ok) return { error: result.message };

  revalidatePath(eventPath(eventId), "layout");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Posters
// ---------------------------------------------------------------------------

export async function createPoster(
  eventId: string,
  input: posters.PosterInput,
) {
  const admin = await requireAdmin();

  const result = await posters.createPoster(admin, eventId, input);
  if (!result.ok) return { error: result.message };

  revalidatePath(eventPath(eventId, "posters"));
  return { error: null };
}

export async function deletePoster(posterId: string) {
  const admin = await requireAdmin();

  const result = await posters.deletePoster(admin, posterId);
  if (!result.ok) return { error: result.message };

  revalidatePath(eventPath(result.data.eventId, "posters"));
  return { error: null };
}

export async function importPosters(eventId: string, csv: string) {
  const admin = await requireAdmin();

  const result = await posters.importPosters(admin, eventId, csv);
  if (!result.ok) return { error: result.message, imported: 0 };

  revalidatePath(eventPath(eventId, "posters"));
  return { error: null, imported: result.data.imported };
}

// ---------------------------------------------------------------------------
// Judges
// ---------------------------------------------------------------------------

/**
 * Creates a judge and returns the plaintext code **once**. It is never stored, so this
 * return value is the only chance to show or print it.
 */
export async function createJudge(eventId: string, name: string, email: string) {
  const admin = await requireAdmin();

  const result = await judges.createJudge(admin, eventId, name, email);
  if (!result.ok) return { error: result.message, code: null };

  revalidatePath(eventPath(eventId, "judges"));
  return { error: null, code: result.data.code };
}

export async function regenerateJudgeCode(judgeId: string) {
  const admin = await requireAdmin();

  const result = await judges.rotateJudgeCode(admin, judgeId);
  if (!result.ok) return { error: result.message, code: null };

  revalidatePath(eventPath(result.data.eventId, "judges"));
  return { error: null, code: result.data.code };
}

/** Fresh codes for every active judge, for the printable card sheet. */
export async function regenerateAllCodes(eventId: string) {
  const admin = await requireAdmin();

  const result = await judges.rotateAllCodes(admin, eventId);
  if (!result.ok) return { error: result.message, cards: [] };

  revalidatePath(eventPath(eventId, "judges"));
  return { error: null, cards: result.data.cards };
}

export async function setJudgeActive(judgeId: string, active: boolean) {
  const admin = await requireAdmin();

  const result = await judges.setJudgeActive(admin, judgeId, active);
  if (!result.ok) return { error: result.message };

  revalidatePath(eventPath(result.data.eventId, "judges"));
  return { error: null };
}

export async function deleteJudge(judgeId: string) {
  const admin = await requireAdmin();

  const result = await judges.deleteJudge(admin, judgeId);
  if (!result.ok) return { error: result.message };

  revalidatePath(eventPath(result.data.eventId, "judges"));
  return { error: null };
}

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

export async function createCriterion(
  eventId: string,
  input: criteria.CriterionInput,
) {
  const admin = await requireAdmin();

  const result = await criteria.createCriterion(admin, eventId, input);
  if (!result.ok) return { error: result.message };

  revalidatePath(eventPath(eventId, "rubric"));
  return { error: null };
}

export async function updateCriterion(
  criterionId: string,
  input: criteria.CriterionInput,
) {
  const admin = await requireAdmin();

  const result = await criteria.updateCriterion(admin, criterionId, input);
  if (!result.ok) return { error: result.message };

  revalidatePath(eventPath(result.data.eventId, "rubric"));
  return { error: null };
}

export async function deleteCriterion(criterionId: string) {
  const admin = await requireAdmin();

  const result = await criteria.deleteCriterion(admin, criterionId);
  if (!result.ok) return { error: result.message };

  revalidatePath(eventPath(result.data.eventId, "rubric"));
  return { error: null };
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export async function runAutoAssign(eventId: string) {
  const admin = await requireAdmin();

  const result = await assignments.runAutoAssign(admin, eventId);
  if (!result.ok) return { error: result.message, count: 0 };

  revalidatePath(eventPath(eventId, "assignments"));
  // The results table flags posters below target coverage, so it moves too.
  revalidatePath(eventPath(eventId));
  return { error: null, count: result.data.count };
}

export async function clearAssignments(eventId: string) {
  const admin = await requireAdmin();

  const result = await assignments.clearAssignments(admin, eventId);
  if (!result.ok) return { error: result.message };

  revalidatePath(eventPath(eventId, "assignments"));
  revalidatePath(eventPath(eventId));
  return { error: null };
}

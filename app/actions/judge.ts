"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { hashCode, normalizeCode } from "@/lib/auth/codes";
import {
  clearJudgeCookie,
  getJudgeSession,
  setJudgeCookie,
  signJudgeToken,
} from "@/lib/auth/judge-session";
import { isRateLimited, recordFailedAttempt } from "@/lib/auth/rate-limit";
import { one } from "@/lib/db";
import { env } from "@/lib/env";
import * as submissions from "@/lib/services/submissions";

/**
 * Server Actions are reachable by direct POST, not only through the UI, so every one of
 * these re-checks the session itself rather than trusting that proxy.ts ran.
 */

export type SignInResult = { error: string };

export async function signIn(
  _prev: SignInResult | null,
  formData: FormData,
): Promise<SignInResult> {
  const raw = String(formData.get("code") ?? "");
  const code = normalizeCode(raw);

  // The limiter is keyed on what was typed, not on the client's IP — see
  // lib/auth/rate-limit.ts for why an IP key is wrong on a LAN. A malformed entry has
  // no canonical form, so it is bucketed under the hash of the raw input: junk still
  // counts as an attempt, but only against itself.
  const attemptKey = hashCode(code ?? `raw:${raw.slice(0, 64)}`, env.judgeCodePepper);

  if (await isRateLimited(attemptKey)) {
    return { error: "Too many attempts. Wait 15 minutes and try again." };
  }

  // A malformed code never reaches the database, but it still counts as an attempt so
  // the limiter cannot be bypassed by sending junk.
  if (!code) {
    await recordFailedAttempt(attemptKey);
    return { error: "That code doesn't look right. Check for typos." };
  }

  const judge = await one<{ id: string; event_id: string; active: boolean }>(
    "select id, event_id, active from judges where code_hash = $1",
    [hashCode(code, env.judgeCodePepper)],
  );

  if (!judge || !judge.active) {
    await recordFailedAttempt(attemptKey);
    // Deliberately identical to the malformed-code message: distinguishing "no such
    // code" from "code deactivated" would confirm which codes exist.
    return { error: "That code doesn't look right. Check for typos." };
  }

  const event = await one<{ status: string }>(
    "select status from events where id = $1",
    [judge.event_id],
  );

  if (event?.status === "draft") {
    return { error: "Judging hasn't opened yet. Check with the organisers." };
  }

  await setJudgeCookie(
    await signJudgeToken({ judgeId: judge.id, eventId: judge.event_id }),
  );

  redirect("/judge");
}

export async function signOut() {
  await clearJudgeCookie();
  redirect("/");
}

export type SaveResult = { ok: true } | { ok: false; error: string };

/** Shared by the draft autosave and the final submit. */
async function save(
  posterId: string,
  scores: Record<string, number>,
  comment: string,
  status: "draft" | "submitted",
): Promise<SaveResult> {
  const session = await getJudgeSession();
  if (!session) return { ok: false, error: "Your session expired. Sign in again." };

  // The write itself, its error contract, and the SQL-side event check all live in the
  // service, so the REST transport shares them rather than reimplementing them.
  const result = await submissions.saveSubmission(
    session,
    posterId,
    scores,
    comment,
    status,
  );

  return result.ok ? { ok: true } : { ok: false, error: result.message };
}

export async function saveDraft(
  posterId: string,
  scores: Record<string, number>,
  comment: string,
): Promise<SaveResult> {
  return save(posterId, scores, comment, "draft");
}

export async function submitScore(
  posterId: string,
  scores: Record<string, number>,
  comment: string,
): Promise<SaveResult> {
  const result = await save(posterId, scores, comment, "submitted");
  if (result.ok) {
    revalidatePath("/judge");
    revalidatePath(`/judge/score/${posterId}`);
  }
  return result;
}

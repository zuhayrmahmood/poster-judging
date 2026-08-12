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
import { clientIp, isRateLimited, recordFailedAttempt } from "@/lib/auth/rate-limit";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase/admin";

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

  const ip = await clientIp();
  if (await isRateLimited(ip)) {
    return { error: "Too many attempts. Wait 15 minutes and try again." };
  }

  // A malformed code never reaches the database, but it still counts as an attempt so
  // the limiter cannot be bypassed by sending junk.
  if (!code) {
    await recordFailedAttempt(ip);
    return { error: "That code doesn't look right. Check for typos." };
  }

  const { data: judge } = await db()
    .from("judges")
    .select("id, event_id, active")
    .eq("code_hash", hashCode(code, env.judgeCodePepper))
    .maybeSingle();

  if (!judge || !judge.active) {
    await recordFailedAttempt(ip);
    // Deliberately identical to the malformed-code message: distinguishing "no such
    // code" from "code deactivated" would confirm which codes exist.
    return { error: "That code doesn't look right. Check for typos." };
  }

  const { data: event } = await db()
    .from("events")
    .select("status")
    .eq("id", judge.event_id)
    .single();

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

  // save_submission re-verifies that the poster belongs to this judge's event and that
  // the event is still active, and does the write atomically.
  const { error } = await db().rpc("save_submission", {
    p_judge_id: session.judgeId,
    p_poster_id: posterId,
    p_status: status,
    p_comment: comment,
    p_scores: scores,
  });

  if (error) {
    const known: Record<string, string> = {
      event_not_active: "Judging has closed for this event.",
      poster_not_in_event: "That poster isn't part of your event.",
      judge_not_found: "Your judge account is no longer active.",
    };
    const message = Object.keys(known).find((key) => error.message.includes(key));
    return { ok: false, error: message ? known[message] : "Couldn't save. Try again." };
  }

  return { ok: true };
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

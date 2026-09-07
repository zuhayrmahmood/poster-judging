import "server-only";

import { query } from "@/lib/db";
import type { SubmissionStatus } from "@/lib/types";

import { fail, ok, type ServiceResult } from "./result";

/**
 * The judge write path.
 *
 * Unlike the admin services this takes a **judge session**, not an admin actor, and it
 * does almost no authorization of its own — `save_submission` does it in SQL, deriving
 * the event from the judge row rather than trusting anything the caller sent, and
 * refusing a poster from a different event or an event that is not open. That contract
 * predates multi-tenancy and is what has kept the judge half tenant-correct all along;
 * this wrapper must not paper over it.
 *
 * The write is an upsert on `(judge, poster)` that replaces the child score rows
 * wholesale, so replaying it overwrites rather than double-counts. The offline outbox
 * depends on that, and so does `PUT` meaning what it says over HTTP.
 */

export type JudgeActor = { judgeId: string; eventId: string };

/** Raised by save_submission via errcode P0001; Postgres puts the text in the message. */
const KNOWN: Record<string, { code: "conflict" | "not_found"; message: string }> = {
  event_not_active: {
    code: "conflict",
    message: "Judging has closed for this event.",
  },
  poster_not_in_event: {
    code: "not_found",
    message: "That poster isn't part of your event.",
  },
  judge_not_found: {
    code: "not_found",
    message: "Your judge account is no longer active.",
  },
};

export async function saveSubmission(
  actor: JudgeActor,
  posterId: string,
  scores: Record<string, number>,
  comment: string,
  status: SubmissionStatus,
): Promise<ServiceResult<null>> {
  try {
    await query("select save_submission($1, $2, $3, $4, $5::jsonb)", [
      actor.judgeId,
      posterId,
      status,
      comment,
      JSON.stringify(scores),
    ]);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const match = Object.keys(KNOWN).find((key) => text.includes(key));
    if (match) return fail(KNOWN[match].code, KNOWN[match].message);

    // A network or database failure, which the client must treat differently from a
    // rejection: the scoring form queues a thrown submit into the outbox and lets the
    // judge move on, but surfaces a well-formed refusal inline and never queues it.
    return fail("conflict", "Couldn't save. Try again.");
  }

  return ok(null);
}

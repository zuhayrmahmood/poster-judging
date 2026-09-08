import "server-only";

import { codeHint, generateCode, hashCode } from "@/lib/auth/codes";
import { query, transaction } from "@/lib/db";
import { env } from "@/lib/env";
import {
  DELETE_OWNED_JUDGE,
  ROTATE_OWNED_JUDGE_CODE,
  SET_OWNED_JUDGE_ACTIVE,
} from "@/lib/sql/scoped";
import type { Judge } from "@/lib/types";

import { fail, notFound, ok, type Actor, type ServiceResult } from "./result";
import { getEventScope, isUuid } from "./scope";

/**
 * `judges.code_hash` is unique across the whole platform, not per event, because the
 * judge sign-in page has no event context to scope a lookup by — the code alone has to
 * resolve to a judge. With one event a collision was vanishingly unlikely and surfaced
 * as a bare "Couldn't add that judge"; across many tenants it is still unlikely but no
 * longer something to leave as an unexplained failure. Retry instead.
 */
const CODE_COLLISION = "judges_code_hash_key";
const CODE_RETRIES = 5;

function isCodeCollision(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes(CODE_COLLISION);
}

export async function listJudges(
  actor: Actor,
  eventId: string,
): Promise<ServiceResult<Judge[]>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  // Never `select *`: code_hash must not reach a client component.
  return ok(
    await query<Judge>(
      `select id, event_id, name, email, code_hint, active, created_at
         from judges where event_id = $1 order by name`,
      [eventId],
    ),
  );
}

/**
 * Creates a judge and returns the plaintext code **once**. It is never stored, so this
 * return value is the only chance to show or print it.
 */
export async function createJudge(
  actor: Actor,
  eventId: string,
  name: string,
  email: string,
): Promise<ServiceResult<{ code: string }>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  const trimmed = name.trim();
  if (!trimmed) return fail("invalid", "Give the judge a name.");

  for (let attempt = 0; attempt < CODE_RETRIES; attempt++) {
    const code = generateCode();
    try {
      await query(
        `insert into judges (event_id, name, email, code_hash, code_hint)
         values ($1, $2, $3, $4, $5)`,
        [
          eventId,
          trimmed,
          email.trim() || null,
          hashCode(code, env.judgeCodePepper),
          codeHint(code),
        ],
      );
      return ok({ code });
    } catch (error) {
      if (isCodeCollision(error)) continue;
      return fail("conflict", "Couldn't add that judge.");
    }
  }

  return fail("conflict", "Couldn't allocate an unused access code. Try again.");
}

export async function rotateJudgeCode(
  actor: Actor,
  judgeId: string,
): Promise<ServiceResult<{ code: string; eventId: string }>> {
  if (!isUuid(judgeId)) return notFound();

  for (let attempt = 0; attempt < CODE_RETRIES; attempt++) {
    const code = generateCode();
    try {
      const rows = await query<{ id: string; event_id: string }>(ROTATE_OWNED_JUDGE_CODE, [
        judgeId,
        hashCode(code, env.judgeCodePepper),
        codeHint(code),
        actor.id,
      ]);
      // Zero rows means the judge is missing or belongs to another organisation. The
      // caller is told the same thing either way.
      if (rows.length === 0) return notFound();
      return ok({ code, eventId: rows[0].event_id });
    } catch (error) {
      if (isCodeCollision(error)) continue;
      return fail("conflict", "Couldn't regenerate that code.");
    }
  }

  return fail("conflict", "Couldn't allocate an unused access code. Try again.");
}

export type JudgeCard = { name: string; code: string };

/**
 * Issues a fresh code to every active judge and returns all of them in plaintext, for
 * the printable card sheet.
 *
 * There is no way to reprint an existing code — only the hash is stored — so printing
 * cards necessarily means rotating them. That is the safe default anyway: it guarantees
 * the sheet in the organiser's hand matches what the database will accept.
 *
 * All-or-nothing, in one transaction. Rotating one judge at a time (KNOWN-ISSUES.md #1)
 * meant a failure part-way through committed new hashes for the judges already
 * processed while discarding their only copy of the plaintext — locking them out at
 * exactly the moment the cards were being printed.
 */
export async function rotateAllCodes(
  actor: Actor,
  eventId: string,
): Promise<ServiceResult<{ cards: JudgeCard[] }>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  const judges = await query<{ id: string; name: string }>(
    "select id, name from judges where event_id = $1 and active order by name",
    [eventId],
  );
  if (judges.length === 0) return fail("invalid", "No active judges.");

  for (let attempt = 0; attempt < CODE_RETRIES; attempt++) {
    // Distinct within the batch as well as against the table — two judges drawing the
    // same code would violate the unique index halfway through the transaction.
    const seen = new Set<string>();
    const cards = judges.map((judge) => {
      let code = generateCode();
      while (seen.has(code)) code = generateCode();
      seen.add(code);
      return { id: judge.id, name: judge.name, code };
    });

    try {
      await transaction(async (tx) => {
        for (const card of cards) {
          await tx.query(
            "update judges set code_hash = $1, code_hint = $2 where id = $3",
            [hashCode(card.code, env.judgeCodePepper), codeHint(card.code), card.id],
          );
        }
      });
      return ok({ cards: cards.map(({ name, code }) => ({ name, code })) });
    } catch (error) {
      if (isCodeCollision(error)) continue;
      return fail("conflict", "Couldn't rotate all codes.");
    }
  }

  return fail("conflict", "Couldn't allocate unused access codes. Try again.");
}

export async function setJudgeActive(
  actor: Actor,
  judgeId: string,
  active: boolean,
): Promise<ServiceResult<{ eventId: string }>> {
  if (!isUuid(judgeId)) return notFound();

  const rows = await query<{ id: string; event_id: string }>(SET_OWNED_JUDGE_ACTIVE, [
    judgeId,
    active,
    actor.id,
  ]);
  return rows.length === 0 ? notFound() : ok({ eventId: rows[0].event_id });
}

export async function deleteJudge(
  actor: Actor,
  judgeId: string,
): Promise<ServiceResult<{ eventId: string }>> {
  if (!isUuid(judgeId)) return notFound();

  const rows = await query<{ id: string; event_id: string }>(DELETE_OWNED_JUDGE, [judgeId, actor.id]);
  return rows.length === 0 ? notFound() : ok({ eventId: rows[0].event_id });
}

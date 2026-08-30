import "server-only";

import { query } from "@/lib/db";

/**
 * Throttles access-code guessing.
 *
 * **Keyed on the code that was typed, not on the client's IP.** The Vercel deployment
 * keyed on `x-forwarded-for`, which worked because the edge always set it. Judges now
 * reach this server directly over the venue LAN, where nothing sets that header at all,
 * so every judge in the hall would have collapsed onto a single key: ten mistyped codes
 * anywhere in the room would lock out everyone for fifteen minutes. That is
 * KNOWN-ISSUES.md #3, and on a LAN it is a certainty rather than a risk.
 *
 * Keying on the attempted code fixes both halves. Brute-forcing one judge's code is
 * still throttled after ten guesses, and a judge fumbling their own card never affects
 * anybody else. The key stored is the peppered hash, never the code itself, so the
 * table is not a list of guessable secrets.
 *
 * Only *failed* attempts are recorded, so a judge who signs in legitimately several
 * times (new phone, cleared cookies) is never locked out.
 */

const WINDOW_MINUTES = 15;
const MAX_FAILURES = 10;

export async function isRateLimited(codeHash: string): Promise<boolean> {
  try {
    const rows = await query<{ failures: number }>(
      `select count(*)::int as failures
         from login_attempts
        where code_hash = $1
          and attempted_at > now() - ($2 || ' minutes')::interval`,
      [codeHash, String(WINDOW_MINUTES)],
    );
    return (rows[0]?.failures ?? 0) >= MAX_FAILURES;
  } catch {
    // Fail open on an infrastructure error: locking every judge out of a live event is a
    // worse outcome than briefly losing the throttle on an already high-entropy code.
    return false;
  }
}

export async function recordFailedAttempt(codeHash: string): Promise<void> {
  try {
    await query("insert into login_attempts (code_hash) values ($1)", [codeHash]);

    // Opportunistic cleanup so the table cannot grow without bound. Cheap and indexed.
    if (Math.random() < 0.02) {
      await query("select prune_login_attempts()");
    }
  } catch {
    // Never let bookkeeping fail a sign-in attempt.
  }
}

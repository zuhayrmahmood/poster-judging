import "server-only";

import { headers } from "next/headers";

import { db } from "@/lib/supabase/admin";

/**
 * Throttles access-code guessing. Postgres-backed rather than Redis because Vercel
 * Hobby has no Redis, and the volume here is trivial — a few hundred rows per event.
 *
 * Only *failed* attempts are recorded, so a judge who signs in legitimately several
 * times (new phone, cleared cookies) is never locked out.
 */

const WINDOW_MINUTES = 15;
const MAX_FAILURES = 10;

/** Best-effort client IP. Vercel always sets x-forwarded-for at the edge. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    // Left-most entry is the original client; the rest are proxies.
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip") ?? "0.0.0.0";
}

export async function isRateLimited(ip: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

  const { count, error } = await db()
    .from("login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("attempted_at", since);

  // Fail open on an infrastructure error: locking every judge out of a live event is a
  // worse outcome than briefly losing the throttle on an already high-entropy code.
  if (error) return false;

  return (count ?? 0) >= MAX_FAILURES;
}

export async function recordFailedAttempt(ip: string): Promise<void> {
  await db().from("login_attempts").insert({ ip });

  // Opportunistic cleanup so the table cannot grow without bound. Cheap, indexed, and
  // avoids needing a cron job on a plan that only allows two per day.
  if (Math.random() < 0.02) {
    await db().rpc("prune_login_attempts");
  }
}

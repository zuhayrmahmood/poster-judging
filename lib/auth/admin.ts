import "server-only";

import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Organiser authentication.
 *
 * There is no password and no login page. Admin access is the capability of holding a
 * token that only the Electron main process knows: it generates 32 random bytes at
 * launch, passes them to this server as PJ_ADMIN_TOKEN, and writes the same value as a
 * cookie into the desktop window's session before loading the dashboard.
 *
 * Two independent things keep that cookie away from a judge's phone:
 *
 *   1. The token is never rendered into a page and the cookie is httpOnly, so nothing
 *      served to a phone can read it.
 *   2. The desktop window loads `http://localhost:<port>`, while phones use the LAN
 *      address. Cookies are scoped by host, so a cookie set for `localhost` is never
 *      sent to `192.168.x.x` — a phone cannot present this cookie even in principle.
 *
 * This replaces Supabase Auth plus the `admins` table. It also removes the setup snag
 * that used to bite hardest: signing in successfully but bouncing off /admin because
 * nobody had inserted the matching `admins` row.
 */

export const ADMIN_COOKIE = "pj_admin";

export type AdminUser = {
  name: string;
  /** Shown in the dashboard header, where the signed-in email used to go. */
  label: string;
};

const ORGANISER: AdminUser = { name: "Organiser", label: "This device" };

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function getAdmin(): Promise<AdminUser | null> {
  const expected = process.env.PJ_ADMIN_TOKEN;

  if (!expected) {
    // `npm run dev` without the Electron shell has no token to check against. Allowing
    // it keeps the dashboard reachable while working on the app; refusing in production
    // means a packaged build that somehow lost its token locks the dashboard rather
    // than opening it to the venue.
    if (process.env.NODE_ENV === "production") return null;
    return ORGANISER;
  }

  const presented = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!presented) return null;

  return constantTimeEqual(presented, expected) ? ORGANISER : null;
}

/**
 * Call at the top of every admin page and action. proxy.ts only does a coarse redirect;
 * Server Actions are reachable by direct POST without passing through it, so this is
 * the real boundary.
 *
 * Redirects to the judge sign-in rather than a login page — a phone that wanders onto
 * /admin should land somewhere useful, and there is no organiser login to send it to.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getAdmin();
  if (!admin) redirect("/");
  return admin;
}

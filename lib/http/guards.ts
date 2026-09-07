import "server-only";

import { getAdmin, type AdminUser } from "@/lib/auth/admin";
import { getJudgeSession, type JudgeSession } from "@/lib/auth/judge-session";

import { failure } from "./respond";

/**
 * Request guards for Route Handlers.
 *
 * Handlers must never call `requireAdmin()` or `requireEventScope()` — both call
 * `redirect()`/`notFound()`, which throw a navigation signal meant for a rendering
 * context and would surface as an opaque 500 on an API route. The resolvers here return
 * null instead and let the caller choose a status code.
 */

/**
 * Cross-site request forgery.
 *
 * Next validates the Origin header on Server Action invocations, so the existing action
 * transport got this for free. Route Handlers get nothing: a cookie-authenticated
 * `POST /api/…` is reachable from any page the organiser happens to have open, with
 * their session attached automatically. Every mutating handler must pass through here.
 *
 * The check, in order of preference:
 *
 *   1. `Sec-Fetch-Site` — set by the browser itself and unforgeable by page script.
 *      Must be `same-origin`.
 *   2. `Origin` vs the request host, for anything that does not send Sec-Fetch-Site.
 *   3. Neither header present: allow.
 *
 * Rule 3 looks like a hole and is not. Browsers *always* attach `Origin` to a
 * cross-origin POST, so its total absence means the caller is not a browser — and a
 * non-browser client has no ambient cookie jar for an attacker to borrow. CSRF is
 * specifically the browser's willingness to attach credentials to a request the user
 * did not intend; a curl request carries only what its author passed deliberately.
 *
 * When Bearer tokens arrive for external clients, they skip this check entirely for the
 * same reason: a token is never attached ambiently.
 */
export function requireSameOrigin(request: Request): Response | null {
  const site = request.headers.get("sec-fetch-site");
  if (site) {
    return site === "same-origin"
      ? null
      : forbiddenOrigin(`Blocked a ${site} request.`);
  }

  const origin = request.headers.get("origin");
  if (!origin) return null;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return forbiddenOrigin("Malformed Origin header.");
  }

  // `host` carries the port, matching URL.host, and is what the request was actually
  // addressed to.
  const host = request.headers.get("host");
  return originHost === host ? null : forbiddenOrigin("Origin does not match host.");
}

function forbiddenOrigin(message: string): Response {
  return failure("forbidden_origin", message, 403);
}

/** The signed-in organiser, or null. Never redirects. */
export async function resolveAdmin(): Promise<AdminUser | null> {
  return getAdmin();
}

/** The judge session from the `pj_judge` cookie, or null. Never redirects. */
export async function resolveJudge(): Promise<JudgeSession | null> {
  return getJudgeSession();
}

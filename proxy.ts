import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_COOKIE } from "@/lib/auth/admin";
import { JUDGE_COOKIE, verifyJudgeToken } from "@/lib/auth/judge-session";

/**
 * Route guards. (This file was `middleware.ts` before Next 16 renamed the convention
 * to `proxy.ts`; it now defaults to the Node.js runtime.)
 *
 * Keeps signed-out visitors out of the app shell, and nothing more. There is no session
 * to refresh any longer — the Supabase token dance is gone, judges hold a self-contained
 * JWT and the organiser holds a token issued by the Electron shell.
 *
 * This is not the security boundary. Server Actions are reachable by direct POST
 * without passing through here, so every action re-checks the session and every admin
 * query goes through `requireAdmin()`.
 */

function redirectTo(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  return NextResponse.redirect(url);
}

async function guardJudge(request: NextRequest) {
  const session = await verifyJudgeToken(request.cookies.get(JUDGE_COOKIE)?.value);
  return session ? NextResponse.next() : redirectTo(request, "/");
}

/**
 * Presence check only — the cookie's *value* is verified in `requireAdmin()`, which has
 * access to the expected token. A phone reaching /admin has no such cookie at all
 * (cookies are host-scoped, and the desktop window uses localhost), so this redirects
 * it back to the judge sign-in rather than showing a dashboard shell it cannot load.
 */
function guardAdmin(request: NextRequest) {
  if (process.env.PJ_ADMIN_TOKEN && !request.cookies.get(ADMIN_COOKIE)) {
    return redirectTo(request, "/");
  }

  // Never let anything cache the dashboard: it is live event data.
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/judge")) return guardJudge(request);
  if (pathname.startsWith("/admin")) return guardAdmin(request);

  return NextResponse.next();
}

export const config = {
  // Without a matcher this runs on every request including static assets, which would
  // let the redirects above block CSS and images.
  matcher: ["/judge/:path*", "/admin/:path*"],
};

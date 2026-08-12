import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { JUDGE_COOKIE, verifyJudgeToken } from "@/lib/auth/judge-session";

/**
 * Route guards. (This file was `middleware.ts` before Next 16 renamed the convention
 * to `proxy.ts`; it now defaults to the Node.js runtime.)
 *
 * Two jobs:
 *  1. Keep signed-out visitors out of the app shell.
 *  2. Refresh the admin's Supabase session. Server Components cannot write cookies, so
 *     if this does not run, refreshed tokens are never persisted and admins get
 *     logged out mid-event.
 *
 * This is not the security boundary. Server Actions are reachable by direct POST
 * without passing through here, so every action re-checks the session and every admin
 * query goes through `requireAdmin()`.
 */

function redirectTo(request: NextRequest, pathname: string, search = "") {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = search;
  return NextResponse.redirect(url);
}

async function guardJudge(request: NextRequest) {
  const session = await verifyJudgeToken(request.cookies.get(JUDGE_COOKIE)?.value);
  return session ? NextResponse.next() : redirectTo(request, "/");
}

async function guardAdmin(request: NextRequest) {
  // `response` is reassigned by setAll below so that refreshed auth cookies ride along
  // on whatever we end up returning.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Must happen before the response is committed, or a refresh completing later is lost.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectTo(
      request,
      "/admin/login",
      `?next=${encodeURIComponent(request.nextUrl.pathname)}`,
    );
  }

  // Token refreshes emit Set-Cookie; keep any CDN in front of this from caching them.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/judge")) return guardJudge(request);

  // The login page itself must stay reachable while signed out.
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    return guardAdmin(request);
  }

  return NextResponse.next();
}

export const config = {
  // Without a matcher this runs on every request including static assets, which would
  // let the redirects above block CSS and images.
  matcher: ["/judge/:path*", "/admin/:path*"],
};

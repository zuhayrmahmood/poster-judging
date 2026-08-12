import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { env } from "@/lib/env";

/**
 * Anon-key Supabase client bound to the request's cookies, used *only* to establish who
 * an admin is. All actual data access goes through the service-role client in
 * ./admin.ts after `requireAdmin()` has run.
 *
 * Must be constructed per request — never cached across them, or one admin's session
 * would leak into another's render.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Harmless here: proxy.ts refreshes
          // the session on every /admin request, so the tokens stay current.
        }
      },
    },
  });
}

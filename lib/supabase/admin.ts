import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

let cached: SupabaseClient | null = null;

/**
 * Service-role Supabase client. Bypasses RLS entirely, which is the whole point:
 * every table in this app is RLS deny-all, and all reads and writes funnel through
 * server code that has already checked authorization itself.
 *
 * The `server-only` import above makes bundling this into a client component a build
 * error rather than a leaked key.
 */
export function db(): SupabaseClient {
  if (!cached) {
    cached = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

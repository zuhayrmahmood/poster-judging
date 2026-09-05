import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client, used only for the admin sign-in exchange. It writes the auth cookies
 * that proxy.ts then keeps refreshed. It carries the public anon key, which is safe:
 * every table is RLS deny-all, so this client can read nothing on its own.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

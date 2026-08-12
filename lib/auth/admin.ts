import "server-only";

import { redirect } from "next/navigation";

import { db } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
};

/**
 * Authenticating as a Supabase user is not enough — anyone can sign up against a public
 * project. Membership in the `admins` table is what actually grants access, and it can
 * only be granted by someone with database access.
 */
export async function getAdmin(): Promise<AdminUser | null> {
  const supabase = await createServerSupabase();

  // getUser() revalidates the JWT with the auth server. getSession() would trust a
  // cookie the client could have tampered with.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: admin } = await db()
    .from("admins")
    .select("id, email, name")
    .eq("id", user.id)
    .maybeSingle();

  return admin ?? null;
}

/**
 * Call at the top of every admin page and action. proxy.ts only does a coarse redirect;
 * Server Actions are reachable by direct POST without passing through it, so this is
 * the real boundary.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

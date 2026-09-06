import "server-only";

import { notFound, redirect } from "next/navigation";

import { one } from "@/lib/db";
import { getEventScope, type EventScope } from "@/lib/services/scope";
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

  return one<AdminUser>("select id, email, name from admins where id = $1", [user.id]);
}

/**
 * Call at the top of every admin page and action. proxy.ts only does a coarse redirect;
 * Server Actions are reachable by direct POST without passing through it, so this is
 * the real authentication boundary.
 *
 * It proves the caller is *an* organiser and nothing more. For anything addressed by an
 * event or a row inside one, that is not enough — use `requireEventScope` below, or a
 * service function, both of which prove the caller owns the thing they named.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

/**
 * The event, proven to belong to an organisation the caller is a member of.
 *
 * `notFound()` rather than a redirect: the caller *is* a signed-in organiser, so
 * bouncing them to the login page would be wrong. A 404 rather than a 403 because a 403
 * confirms the event exists, which would turn the id space into an oracle for other
 * organisers' events.
 */
export async function requireEventScope(
  eventId: string,
): Promise<{ admin: AdminUser; scope: EventScope }> {
  const admin = await requireAdmin();
  const scope = await getEventScope(admin, eventId);
  if (!scope) notFound();
  return { admin, scope };
}

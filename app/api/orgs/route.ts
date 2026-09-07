import { resolveAdmin } from "@/lib/http/guards";
import { collection, unauthenticated } from "@/lib/http/respond";
import * as events from "@/lib/services/events";

/**
 * Route Handlers are transport only: resolve the actor, call a service, map the result
 * to a status code. Authorization lives in lib/services/*, shared with the Server
 * Action transport, so the two can never drift into different answers about who may
 * touch what.
 *
 * proxy.ts deliberately does not match /api/*. These handlers resolve their own actor,
 * exactly as Server Actions do.
 */
export async function GET() {
  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  return collection(await events.listOrgs(admin));
}

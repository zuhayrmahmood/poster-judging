import "server-only";

import { one } from "@/lib/db";
import { SELECT_EVENT_SCOPE, SELECT_ORG_SCOPE } from "@/lib/sql/scoped";
import type { MembershipRole } from "@/lib/types";

import type { Actor } from "./result";

/**
 * "Is this caller an organiser for *this* event?" — the question `requireAdmin()` never
 * asked. It answers only "are you an organiser at all", which is why every admin action
 * was reachable for every event on the platform.
 *
 * Returns null for both "no such event" and "not yours", on purpose. See
 * lib/services/result.ts.
 */

export type EventScope = {
  eventId: string;
  orgId: string;
  role: MembershipRole;
};

export type OrgScope = {
  orgId: string;
  name: string;
  slug: string;
  role: MembershipRole;
};

export async function getEventScope(
  actor: Actor,
  eventId: string,
): Promise<EventScope | null> {
  // A malformed id would make Postgres raise 22P02 on the uuid cast rather than simply
  // not matching, which would leak "that was not even a valid id" as a distinct signal.
  if (!isUuid(eventId)) return null;

  const row = await one<{ event_id: string; org_id: string; role: MembershipRole }>(
    SELECT_EVENT_SCOPE,
    [eventId, actor.id],
  );
  if (!row) return null;

  return { eventId: row.event_id, orgId: row.org_id, role: row.role };
}

export async function getOrgScope(
  actor: Actor,
  orgId: string,
): Promise<OrgScope | null> {
  if (!isUuid(orgId)) return null;

  const row = await one<{
    org_id: string;
    name: string;
    slug: string;
    role: MembershipRole;
  }>(SELECT_ORG_SCOPE, [orgId, actor.id]);
  if (!row) return null;

  return { orgId: row.org_id, name: row.name, slug: row.slug, role: row.role };
}

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

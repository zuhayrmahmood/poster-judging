import "server-only";

import { one, query } from "@/lib/db";
import {
  LIST_EVENTS_FOR_ADMIN,
  LIST_ORGS_FOR_ADMIN,
  SELECT_PRIMARY_EVENT_FOR_ADMIN,
} from "@/lib/sql/scoped";
import type { Event, EventStatus, MembershipRole } from "@/lib/types";

import { fail, notFound, ok, type Actor, type ServiceResult } from "./result";
import { getEventScope, getOrgScope } from "./scope";

/** Every organisation the caller belongs to. */
export async function listOrgs(actor: Actor) {
  return query<{
    id: string;
    name: string;
    slug: string;
    created_at: string;
    role: MembershipRole;
  }>(LIST_ORGS_FOR_ADMIN, [actor.id]);
}

/** One organisation, proven to be one the caller belongs to. */
export async function getOrg(
  actor: Actor,
  orgId: string,
): Promise<ServiceResult<{ id: string; name: string; slug: string; role: MembershipRole }>> {
  const scope = await getOrgScope(actor, orgId);
  if (!scope) return notFound();

  return ok({
    id: scope.orgId,
    name: scope.name,
    slug: scope.slug,
    role: scope.role,
  });
}

/** Renaming an organisation is an owner's call, not any member's. */
export async function renameOrg(
  actor: Actor,
  orgId: string,
  name: string,
): Promise<ServiceResult<null>> {
  const scope = await getOrgScope(actor, orgId);
  if (!scope) return notFound();
  // A plain member gets the same answer as a non-member: no confirmation that the org
  // exists and they merely lack the role.
  if (scope.role !== "owner") return notFound();

  const trimmed = name.trim();
  if (!trimmed) return fail("invalid", "Give the organisation a name.");

  await query("update organisations set name = $1 where id = $2", [trimmed, orgId]);
  return ok(null);
}

/** Every event the caller can reach, across all their organisations. */
export async function listEvents(actor: Actor): Promise<Event[]> {
  return query<Event>(LIST_EVENTS_FOR_ADMIN, [actor.id]);
}

/**
 * The event the dashboard shows while the UI is one-event-at-a-time. Scoped to the
 * caller, so two organisers on the same deployment land on their own event.
 */
export async function getPrimaryEvent(actor: Actor): Promise<Event | null> {
  return one<Event>(SELECT_PRIMARY_EVENT_FOR_ADMIN, [actor.id]);
}

/** The event, proven to belong to an org the caller is a member of. */
export async function getEvent(
  actor: Actor,
  eventId: string,
): Promise<ServiceResult<Event>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  const event = await one<Event>("select * from events where id = $1", [eventId]);
  return event ? ok(event) : notFound();
}

export async function createEvent(
  actor: Actor,
  orgId: string,
  name: string,
): Promise<ServiceResult<Event>> {
  const org = await getOrgScope(actor, orgId);
  if (!org) return notFound();

  const trimmed = name.trim();
  if (!trimmed) return fail("invalid", "Give the event a name.");

  const base =
    trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "event";

  // Slugs are unique per organisation now, so the collision probe is scoped too —
  // otherwise one org's event names would leak the existence of another's.
  const clash = await one<{ id: string }>(
    "select id from events where org_id = $1 and slug = $2",
    [orgId, base],
  );
  const slug = clash ? `${base}-${Date.now().toString(36).slice(-4)}` : base;

  try {
    const event = await one<Event>(
      `insert into events (org_id, name, slug, status)
       values ($1, $2, $3, 'draft')
       returning *`,
      [orgId, trimmed, slug],
    );
    return event ? ok(event) : fail("conflict", "Couldn't create the event.");
  } catch {
    return fail("conflict", "Couldn't create the event.");
  }
}

export async function renameEvent(
  actor: Actor,
  eventId: string,
  name: string,
): Promise<ServiceResult<null>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  const trimmed = name.trim();
  if (!trimmed) return fail("invalid", "Give the event a name.");

  await query("update events set name = $1 where id = $2", [trimmed, eventId]);
  return ok(null);
}

const STATUSES: readonly EventStatus[] = ["draft", "active", "locked"];

export async function setStatus(
  actor: Actor,
  eventId: string,
  status: EventStatus,
): Promise<ServiceResult<null>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  if (!STATUSES.includes(status)) return fail("invalid", "Unknown status.");

  await query("update events set status = $1 where id = $2", [status, eventId]);
  return ok(null);
}

/**
 * The PATCH shape: any subset of the mutable fields, applied in one pass.
 *
 * Opening and closing judging is a status field, so it belongs here rather than behind
 * `/open` and `/close` action endpoints — the state is the resource's, not a verb.
 */
export type EventPatch = {
  name?: string;
  status?: EventStatus;
  target_judges_per_poster?: number;
};

export async function updateEvent(
  actor: Actor,
  eventId: string,
  patch: EventPatch,
): Promise<ServiceResult<Event>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  if (patch.name !== undefined && !patch.name.trim()) {
    return fail("invalid", "Give the event a name.");
  }
  if (patch.status !== undefined && !STATUSES.includes(patch.status)) {
    return fail("invalid", "Unknown status.");
  }
  if (
    patch.target_judges_per_poster !== undefined &&
    !Number.isFinite(patch.target_judges_per_poster)
  ) {
    return fail("invalid", "Give a number.");
  }

  // Build the SET list from whatever was supplied, so an absent field is left alone
  // rather than overwritten with a default.
  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.name !== undefined) {
    params.push(patch.name.trim());
    sets.push(`name = $${params.length}`);
  }
  if (patch.status !== undefined) {
    params.push(patch.status);
    sets.push(`status = $${params.length}`);
  }
  if (patch.target_judges_per_poster !== undefined) {
    params.push(
      Math.max(1, Math.min(20, Math.round(patch.target_judges_per_poster))),
    );
    sets.push(`target_judges_per_poster = $${params.length}`);
  }

  if (sets.length === 0) return fail("invalid", "Nothing to update.");

  params.push(eventId);
  const event = await one<Event>(
    `update events set ${sets.join(", ")} where id = $${params.length} returning *`,
    params,
  );
  return event ? ok(event) : notFound();
}

export async function setTargetJudges(
  actor: Actor,
  eventId: string,
  target: number,
): Promise<ServiceResult<null>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  if (!Number.isFinite(target)) return fail("invalid", "Give a number.");
  const clamped = Math.max(1, Math.min(20, Math.round(target)));

  await query("update events set target_judges_per_poster = $1 where id = $2", [
    clamped,
    eventId,
  ]);
  return ok(null);
}

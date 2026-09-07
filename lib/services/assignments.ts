import "server-only";

import { autoAssign } from "@/lib/assign";
import { one, query, transaction } from "@/lib/db";

import { fail, notFound, ok, type Actor, type ServiceResult } from "./result";
import { getEventScope } from "./scope";

/**
 * Replaces all assignments for the event with a freshly dealt plan.
 *
 * Deliberately destructive and deliberately *not* touching submissions: a judge who has
 * already scored a poster keeps that score even if the reshuffle moves the poster off
 * their list, because `submissions` is keyed independently of `assignments`.
 */
export async function runAutoAssign(
  actor: Actor,
  eventId: string,
): Promise<ServiceResult<{ count: number }>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  const [event, posters, judges] = await Promise.all([
    one<{ target_judges_per_poster: number }>(
      "select target_judges_per_poster from events where id = $1",
      [eventId],
    ),
    query<{ id: string; code: string; location: string | null }>(
      "select id, code, location from posters where event_id = $1",
      [eventId],
    ),
    query<{ id: string }>(
      "select id from judges where event_id = $1 and active order by name",
      [eventId],
    ),
  ]);

  if (!event || posters.length === 0 || judges.length === 0) {
    return fail("invalid", "Add at least one poster and one active judge first.");
  }

  const plan = autoAssign(
    posters,
    judges.map((j) => j.id),
    event.target_judges_per_poster,
  );

  // Swap the plan in atomically: a failure half-way must not leave the event with the
  // old assignments deleted and the new ones missing, mid-session.
  try {
    await transaction(async (tx) => {
      await tx.query("delete from assignments where event_id = $1", [eventId]);

      const params: unknown[] = [eventId];
      const values = plan
        .map((a) => {
          const base = params.length;
          params.push(a.judgeId, a.posterId, a.sortOrder);
          return `($1, $${base + 1}, $${base + 2}, $${base + 3})`;
        })
        .join(", ");

      if (plan.length > 0) {
        await tx.query(
          `insert into assignments (event_id, judge_id, poster_id, sort_order)
           values ${values}`,
          params,
        );
      }
    });
  } catch {
    return fail("conflict", "Couldn't save the assignments.");
  }

  return ok({ count: plan.length });
}

export type AssignmentRow = {
  judge_id: string;
  judge_name: string;
  poster_id: string;
  poster_code: string;
  sort_order: number;
};

/** The current plan, in each judge's walking order. */
export async function listAssignments(
  actor: Actor,
  eventId: string,
): Promise<ServiceResult<AssignmentRow[]>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  return ok(
    await query<AssignmentRow>(
      `select a.judge_id, j.name as judge_name,
              a.poster_id, p.code as poster_code, a.sort_order
         from assignments a
         join judges j on j.id = a.judge_id
         join posters p on p.id = a.poster_id
        where a.event_id = $1
        order by j.name, a.sort_order`,
      [eventId],
    ),
  );
}

export async function clearAssignments(
  actor: Actor,
  eventId: string,
): Promise<ServiceResult<null>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  await query("delete from assignments where event_id = $1", [eventId]);
  return ok(null);
}

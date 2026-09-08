import "server-only";

import { numOr, query } from "@/lib/db";
import { DELETE_OWNED_CRITERION, UPDATE_OWNED_CRITERION } from "@/lib/sql/scoped";
import type { Criterion } from "@/lib/types";

import { fail, notFound, ok, type Actor, type ServiceResult } from "./result";
import { getEventScope, isUuid } from "./scope";

export type CriterionInput = {
  label: string;
  description: string;
  weight: number;
  maxScore: number;
};

export async function listCriteria(
  actor: Actor,
  eventId: string,
): Promise<ServiceResult<Criterion[]>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  const rows = await query<Criterion>(
    "select * from criteria where event_id = $1 order by sort_order, label",
    [eventId],
  );
  // `weight` is numeric, which pg hands back as a string.
  return ok(rows.map((row) => ({ ...row, weight: numOr(row.weight, 1) })));
}

/** Mirrors the CHECK constraints in 0001_init.sql so the error is a message, not a 500. */
function validate(input: CriterionInput): string | null {
  if (!input.label.trim()) return "Give the criterion a label.";
  if (!Number.isFinite(input.weight) || input.weight <= 0) {
    return "Weight must be greater than zero.";
  }
  if (
    !Number.isInteger(input.maxScore) ||
    input.maxScore < 2 ||
    input.maxScore > 100
  ) {
    return "Maximum score must be a whole number between 2 and 100.";
  }
  return null;
}

export async function createCriterion(
  actor: Actor,
  eventId: string,
  input: CriterionInput,
): Promise<ServiceResult<null>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  const invalid = validate(input);
  if (invalid) return fail("invalid", invalid);

  await query(
    `insert into criteria (event_id, label, description, weight, max_score, sort_order)
     select $1, $2, $3, $4, $5, count(*) from criteria where event_id = $1`,
    [
      eventId,
      input.label.trim(),
      input.description.trim() || null,
      input.weight,
      input.maxScore,
    ],
  );
  return ok(null);
}

export async function updateCriterion(
  actor: Actor,
  criterionId: string,
  input: CriterionInput,
): Promise<ServiceResult<{ eventId: string }>> {
  if (!isUuid(criterionId)) return notFound();

  const invalid = validate(input);
  if (invalid) return fail("invalid", invalid);

  const rows = await query<{ id: string; event_id: string }>(UPDATE_OWNED_CRITERION, [
    criterionId,
    input.label.trim(),
    input.description.trim() || null,
    input.weight,
    input.maxScore,
    actor.id,
  ]);
  return rows.length === 0 ? notFound() : ok({ eventId: rows[0].event_id });
}

export async function deleteCriterion(
  actor: Actor,
  criterionId: string,
): Promise<ServiceResult<{ eventId: string }>> {
  if (!isUuid(criterionId)) return notFound();

  const rows = await query<{ id: string; event_id: string }>(DELETE_OWNED_CRITERION, [
    criterionId,
    actor.id,
  ]);
  return rows.length === 0 ? notFound() : ok({ eventId: rows[0].event_id });
}

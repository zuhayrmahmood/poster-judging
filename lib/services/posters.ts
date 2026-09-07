import "server-only";

import { one, query } from "@/lib/db";
import { DELETE_OWNED_POSTER, SELECT_OWNED_POSTER } from "@/lib/sql/scoped";
import type { Poster } from "@/lib/types";

import { fail, notFound, ok, type Actor, type ServiceResult } from "./result";
import { getEventScope, isUuid } from "./scope";

export type PosterInput = {
  code: string;
  title: string;
  presenters: string;
  location: string;
};

export async function listPosters(
  actor: Actor,
  eventId: string,
): Promise<ServiceResult<Poster[]>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  return ok(
    await query<Poster>(
      "select * from posters where event_id = $1 order by location nulls last, code",
      [eventId],
    ),
  );
}

/**
 * One poster, ownership-checked.
 *
 * The unscoped predecessor is what let any signed-in organiser render another event's
 * poster — and, through the drill-down page, its full per-judge score sheets.
 */
export async function getPoster(
  actor: Actor,
  posterId: string,
): Promise<ServiceResult<Poster>> {
  if (!isUuid(posterId)) return notFound();

  const poster = await one<Poster>(SELECT_OWNED_POSTER, [posterId, actor.id]);
  return poster ? ok(poster) : notFound();
}

export async function createPoster(
  actor: Actor,
  eventId: string,
  input: PosterInput,
): Promise<ServiceResult<null>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  const code = input.code.trim();
  const title = input.title.trim();
  if (!code || !title) return fail("invalid", "A poster needs a code and a title.");

  try {
    await query(
      `insert into posters (event_id, code, title, presenter_names, location)
       values ($1, $2, $3, $4::text[], $5)`,
      [eventId, code, title, splitNames(input.presenters), input.location.trim() || null],
    );
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return fail(
      "conflict",
      text.includes("posters_event_id_code_key")
        ? `Poster code "${code}" is already used in this event.`
        : "Couldn't add that poster.",
    );
  }

  return ok(null);
}

export async function deletePoster(
  actor: Actor,
  posterId: string,
): Promise<ServiceResult<null>> {
  if (!isUuid(posterId)) return notFound();

  // Ownership is a join inside the DELETE, so there is no window between checking and
  // deleting, and no second round trip.
  const rows = await query<{ id: string }>(DELETE_OWNED_POSTER, [posterId, actor.id]);
  return rows.length === 0 ? notFound() : ok(null);
}

/**
 * Bulk import from pasted CSV: `code,title,presenters,location`.
 * Presenters are separated by `;` so a comma inside a name list cannot break the row.
 *
 * NOTE: still splits on a bare comma, so it does not round-trip with the quoted RFC
 * 4180 output that lib/csv.ts writes — KNOWN-ISSUES.md #1, unchanged by this refactor.
 */
export async function importPosters(
  actor: Actor,
  eventId: string,
  csv: string,
): Promise<ServiceResult<{ imported: number }>> {
  const scope = await getEventScope(actor, eventId);
  if (!scope) return notFound();

  const rows = csv
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(","));

  // Tolerate a header row.
  if (rows[0]?.[0]?.toLowerCase() === "code") rows.shift();

  const posters = rows.flatMap((cells) => {
    const [code, title, presenters = "", location = ""] = cells.map((c) => c.trim());
    if (!code || !title) return [];
    return [
      {
        code,
        title,
        presenter_names: splitNames(presenters),
        location: location || null,
      },
    ];
  });

  if (posters.length === 0) return fail("invalid", "No usable rows found.");

  // One statement, so a duplicate code anywhere in the paste rolls the whole import
  // back rather than leaving half the posters in.
  const params: unknown[] = [eventId];
  const values = posters
    .map((poster) => {
      const base = params.length;
      params.push(poster.code, poster.title, poster.presenter_names, poster.location);
      return `($1, $${base + 1}, $${base + 2}, $${base + 3}::text[], $${base + 4})`;
    })
    .join(", ");

  try {
    await query(
      `insert into posters (event_id, code, title, presenter_names, location)
       values ${values}`,
      params,
    );
  } catch {
    return fail("conflict", "Import failed — check for duplicate poster codes.");
  }

  return ok({ imported: posters.length });
}

function splitNames(value: string): string[] {
  return value
    .split(";")
    .map((name) => name.trim())
    .filter(Boolean);
}

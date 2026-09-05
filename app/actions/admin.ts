"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { autoAssign } from "@/lib/assign";
import { requireAdmin } from "@/lib/auth/admin";
import { codeHint, generateCode, hashCode } from "@/lib/auth/codes";
import { one, query, transaction } from "@/lib/db";
import { env } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";
import type { EventStatus } from "@/lib/types";

/**
 * Every action re-checks admin membership. Server Actions are reachable by direct POST,
 * so proxy.ts having redirected the browser proves nothing.
 */

export async function adminSignOut() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

export async function createEvent(name: string) {
  await requireAdmin();

  const trimmed = name.trim();
  if (!trimmed) return { error: "Give the event a name." };

  const slug =
    trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "event";

  // Slug is unique across events; suffix on collision rather than failing.
  const clash = await one<{ id: string }>("select id from events where slug = $1", [
    slug,
  ]);

  try {
    await query(
      "insert into events (name, slug, status) values ($1, $2, 'draft')",
      [trimmed, clash ? `${slug}-${Date.now().toString(36).slice(-4)}` : slug],
    );
  } catch {
    return { error: "Couldn't create the event." };
  }

  revalidatePath("/admin", "layout");
  return { error: null };
}

export async function renameEvent(eventId: string, name: string) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) return;
  await query("update events set name = $1 where id = $2", [trimmed, eventId]);
  revalidatePath("/admin", "layout");
}

export async function setEventStatus(eventId: string, status: EventStatus) {
  await requireAdmin();
  await query("update events set status = $1 where id = $2", [status, eventId]);
  revalidatePath("/admin", "layout");
}

export async function setTargetJudges(eventId: string, target: number) {
  await requireAdmin();
  const clamped = Math.max(1, Math.min(20, Math.round(target)));
  await query(
    "update events set target_judges_per_poster = $1 where id = $2",
    [clamped, eventId],
  );
  revalidatePath("/admin", "layout");
}

// ---------------------------------------------------------------------------
// Posters
// ---------------------------------------------------------------------------

export type PosterInput = {
  code: string;
  title: string;
  presenters: string;
  location: string;
};

export async function createPoster(eventId: string, input: PosterInput) {
  await requireAdmin();

  try {
    await query(
      `insert into posters (event_id, code, title, presenter_names, location)
       values ($1, $2, $3, $4::text[], $5)`,
      [
        eventId,
        input.code.trim(),
        input.title.trim(),
        splitNames(input.presenters),
        input.location.trim() || null,
      ],
    );
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return {
      error: text.includes("posters_event_id_code_key")
        ? `Poster code "${input.code.trim()}" is already used in this event.`
        : "Couldn't add that poster.",
    };
  }

  revalidatePath("/admin/posters");
  return { error: null };
}

export async function deletePoster(posterId: string) {
  await requireAdmin();
  await query("delete from posters where id = $1", [posterId]);
  revalidatePath("/admin/posters");
}

/**
 * Bulk import from pasted CSV: `code,title,presenters,location`.
 * Presenters are separated by `;` so a comma inside a name list cannot break the row.
 */
export async function importPosters(eventId: string, csv: string) {
  await requireAdmin();

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

  if (posters.length === 0) return { error: "No usable rows found.", imported: 0 };

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
    return {
      error: "Import failed — check for duplicate poster codes.",
      imported: 0,
    };
  }

  revalidatePath("/admin/posters");
  return { error: null, imported: posters.length };
}

function splitNames(value: string): string[] {
  return value
    .split(";")
    .map((name) => name.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Judges
// ---------------------------------------------------------------------------

/**
 * Creates a judge and returns the plaintext code **once**. It is never stored, so this
 * return value is the only chance to show or print it.
 */
export async function createJudge(eventId: string, name: string, email: string) {
  await requireAdmin();

  const code = generateCode();
  try {
    await query(
      `insert into judges (event_id, name, email, code_hash, code_hint)
       values ($1, $2, $3, $4, $5)`,
      [
        eventId,
        name.trim(),
        email.trim() || null,
        hashCode(code, env.judgeCodePepper),
        codeHint(code),
      ],
    );
  } catch {
    return { error: "Couldn't add that judge.", code: null };
  }

  revalidatePath("/admin/judges");
  return { error: null, code };
}

export async function regenerateJudgeCode(judgeId: string) {
  await requireAdmin();

  const code = generateCode();
  try {
    await query(
      "update judges set code_hash = $1, code_hint = $2 where id = $3",
      [hashCode(code, env.judgeCodePepper), codeHint(code), judgeId],
    );
  } catch {
    return { error: "Couldn't regenerate that code.", code: null };
  }

  revalidatePath("/admin/judges");
  return { error: null, code };
}

/**
 * Issues a fresh code to every active judge and returns all of them in plaintext, for
 * the printable card sheet.
 *
 * There is no way to reprint an existing code — only the hash is stored — so printing
 * cards necessarily means rotating them. That is the safe default anyway: it guarantees
 * the sheet in the organiser's hand matches what the database will accept, and it
 * invalidates codes from a previous run of the event.
 *
 * All-or-nothing, in one transaction. Rotating one judge at a time (KNOWN-ISSUES.md #1)
 * meant a failure part-way through committed new hashes for the judges already
 * processed while discarding their only copy of the plaintext — locking them out at
 * exactly the moment the cards were being printed.
 */
export async function regenerateAllCodes(eventId: string) {
  await requireAdmin();

  const judges = await query<{ id: string; name: string }>(
    "select id, name from judges where event_id = $1 and active order by name",
    [eventId],
  );

  if (judges.length === 0) return { error: "No active judges.", cards: [] };

  const cards = judges.map((judge) => ({
    id: judge.id,
    name: judge.name,
    code: generateCode(),
  }));

  try {
    await transaction(async (tx) => {
      for (const card of cards) {
        await tx.query(
          "update judges set code_hash = $1, code_hint = $2 where id = $3",
          [hashCode(card.code, env.judgeCodePepper), codeHint(card.code), card.id],
        );
      }
    });
  } catch {
    return { error: "Couldn't rotate all codes.", cards: [] };
  }

  revalidatePath("/admin/judges");
  return {
    error: null,
    cards: cards.map(({ name, code }) => ({ name, code })),
  };
}

export async function setJudgeActive(judgeId: string, active: boolean) {
  await requireAdmin();
  await query("update judges set active = $1 where id = $2", [active, judgeId]);
  revalidatePath("/admin/judges");
}

export async function deleteJudge(judgeId: string) {
  await requireAdmin();
  await query("delete from judges where id = $1", [judgeId]);
  revalidatePath("/admin/judges");
}

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

export type CriterionInput = {
  label: string;
  description: string;
  weight: number;
  maxScore: number;
};

export async function createCriterion(eventId: string, input: CriterionInput) {
  await requireAdmin();

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

  revalidatePath("/admin/rubric");
}

export async function updateCriterion(criterionId: string, input: CriterionInput) {
  await requireAdmin();
  await query(
    `update criteria
        set label = $1, description = $2, weight = $3, max_score = $4
      where id = $5`,
    [
      input.label.trim(),
      input.description.trim() || null,
      input.weight,
      input.maxScore,
      criterionId,
    ],
  );
  revalidatePath("/admin/rubric");
}

export async function deleteCriterion(criterionId: string) {
  await requireAdmin();
  await query("delete from criteria where id = $1", [criterionId]);
  revalidatePath("/admin/rubric");
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

/**
 * Replaces all assignments for the event with a freshly dealt plan.
 *
 * Deliberately destructive and deliberately *not* touching submissions: a judge who has
 * already scored a poster keeps that score even if the reshuffle moves the poster off
 * their list, because `submissions` is keyed independently of `assignments`.
 */
export async function runAutoAssign(eventId: string) {
  await requireAdmin();

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
    return { error: "Add at least one poster and one active judge first.", count: 0 };
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
    return { error: "Couldn't save the assignments.", count: 0 };
  }

  revalidatePath("/admin/assignments");
  revalidatePath("/admin");
  return { error: null, count: plan.length };
}

export async function clearAssignments(eventId: string) {
  await requireAdmin();
  await query("delete from assignments where event_id = $1", [eventId]);
  revalidatePath("/admin/assignments");
}

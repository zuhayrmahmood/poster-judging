"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { autoAssign } from "@/lib/assign";
import { requireAdmin } from "@/lib/auth/admin";
import { codeHint, generateCode, hashCode } from "@/lib/auth/codes";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase/admin";
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
  const { data: clash } = await db()
    .from("events")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  const { error } = await db()
    .from("events")
    .insert({
      name: trimmed,
      slug: clash ? `${slug}-${Date.now().toString(36).slice(-4)}` : slug,
      status: "draft",
    });

  if (error) return { error: "Couldn't create the event." };

  revalidatePath("/admin", "layout");
  return { error: null };
}

export async function renameEvent(eventId: string, name: string) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) return;
  await db().from("events").update({ name: trimmed }).eq("id", eventId);
  revalidatePath("/admin", "layout");
}

export async function setEventStatus(eventId: string, status: EventStatus) {
  await requireAdmin();
  await db().from("events").update({ status }).eq("id", eventId);
  revalidatePath("/admin", "layout");
}

export async function setTargetJudges(eventId: string, target: number) {
  await requireAdmin();
  const clamped = Math.max(1, Math.min(20, Math.round(target)));
  await db()
    .from("events")
    .update({ target_judges_per_poster: clamped })
    .eq("id", eventId);
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

  const { error } = await db().from("posters").insert({
    event_id: eventId,
    code: input.code.trim(),
    title: input.title.trim(),
    presenter_names: splitNames(input.presenters),
    location: input.location.trim() || null,
  });

  if (error) {
    return { error: error.message.includes("posters_event_id_code_key")
      ? `Poster code "${input.code.trim()}" is already used in this event.`
      : "Couldn't add that poster." };
  }

  revalidatePath("/admin/posters");
  return { error: null };
}

export async function deletePoster(posterId: string) {
  await requireAdmin();
  await db().from("posters").delete().eq("id", posterId);
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
        event_id: eventId,
        code,
        title,
        presenter_names: splitNames(presenters),
        location: location || null,
      },
    ];
  });

  if (posters.length === 0) return { error: "No usable rows found.", imported: 0 };

  const { error } = await db().from("posters").insert(posters);
  if (error) {
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
  const { error } = await db().from("judges").insert({
    event_id: eventId,
    name: name.trim(),
    email: email.trim() || null,
    code_hash: hashCode(code, env.judgeCodePepper),
    code_hint: codeHint(code),
  });

  if (error) return { error: "Couldn't add that judge.", code: null };

  revalidatePath("/admin/judges");
  return { error: null, code };
}

export async function regenerateJudgeCode(judgeId: string) {
  await requireAdmin();

  const code = generateCode();
  const { error } = await db()
    .from("judges")
    .update({ code_hash: hashCode(code, env.judgeCodePepper), code_hint: codeHint(code) })
    .eq("id", judgeId);

  if (error) return { error: "Couldn't regenerate that code.", code: null };

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
 */
export async function regenerateAllCodes(eventId: string) {
  await requireAdmin();

  const { data: judges } = await db()
    .from("judges")
    .select("id, name")
    .eq("event_id", eventId)
    .eq("active", true)
    .order("name");

  if (!judges?.length) return { error: "No active judges.", cards: [] };

  const cards: { name: string; code: string }[] = [];

  for (const judge of judges) {
    const code = generateCode();
    const { error } = await db()
      .from("judges")
      .update({
        code_hash: hashCode(code, env.judgeCodePepper),
        code_hint: codeHint(code),
      })
      .eq("id", judge.id);

    if (error) return { error: "Couldn't rotate all codes.", cards: [] };
    cards.push({ name: judge.name, code });
  }

  revalidatePath("/admin/judges");
  return { error: null, cards };
}

export async function setJudgeActive(judgeId: string, active: boolean) {
  await requireAdmin();
  await db().from("judges").update({ active }).eq("id", judgeId);
  revalidatePath("/admin/judges");
}

export async function deleteJudge(judgeId: string) {
  await requireAdmin();
  await db().from("judges").delete().eq("id", judgeId);
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

  const { count } = await db()
    .from("criteria")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);

  await db().from("criteria").insert({
    event_id: eventId,
    label: input.label.trim(),
    description: input.description.trim() || null,
    weight: input.weight,
    max_score: input.maxScore,
    sort_order: count ?? 0,
  });

  revalidatePath("/admin/rubric");
}

export async function updateCriterion(criterionId: string, input: CriterionInput) {
  await requireAdmin();
  await db()
    .from("criteria")
    .update({
      label: input.label.trim(),
      description: input.description.trim() || null,
      weight: input.weight,
      max_score: input.maxScore,
    })
    .eq("id", criterionId);
  revalidatePath("/admin/rubric");
}

export async function deleteCriterion(criterionId: string) {
  await requireAdmin();
  await db().from("criteria").delete().eq("id", criterionId);
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

  const [{ data: event }, { data: posters }, { data: judges }] = await Promise.all([
    db().from("events").select("target_judges_per_poster").eq("id", eventId).single(),
    db().from("posters").select("id, code, location").eq("event_id", eventId),
    db().from("judges").select("id").eq("event_id", eventId).eq("active", true).order("name"),
  ]);

  if (!event || !posters?.length || !judges?.length) {
    return { error: "Add at least one poster and one active judge first.", count: 0 };
  }

  const plan = autoAssign(
    posters,
    judges.map((j) => j.id),
    event.target_judges_per_poster,
  );

  await db().from("assignments").delete().eq("event_id", eventId);

  const { error } = await db().from("assignments").insert(
    plan.map((a) => ({
      event_id: eventId,
      judge_id: a.judgeId,
      poster_id: a.posterId,
      sort_order: a.sortOrder,
    })),
  );

  if (error) return { error: "Couldn't save the assignments.", count: 0 };

  revalidatePath("/admin/assignments");
  revalidatePath("/admin");
  return { error: null, count: plan.length };
}

export async function clearAssignments(eventId: string) {
  await requireAdmin();
  await db().from("assignments").delete().eq("event_id", eventId);
  revalidatePath("/admin/assignments");
}

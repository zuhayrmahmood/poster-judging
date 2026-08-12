/**
 * Seeds a demo event and prints the judge access codes.
 *
 *   npm run seed
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * JUDGE_CODE_PEPPER. Safe to re-run: it deletes and recreates the `demo-expo` event,
 * which cascades to its posters, judges, assignments and submissions.
 *
 * Codes are shown once here and only ever stored as a peppered hash, exactly as the
 * admin UI does it — so this script is also the quickest way to check that sign-in works
 * end to end.
 */

import { createClient } from "@supabase/supabase-js";

import { autoAssign, loadPerJudge } from "@/lib/assign";
import { codeHint, formatCode, generateCode, hashCode } from "@/lib/auth/codes";

const SLUG = "demo-expo";
const TARGET_JUDGES_PER_POSTER = 3;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
    process.exit(1);
  }
  return value;
}

const db = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const pepper = requireEnv("JUDGE_CODE_PEPPER");

const CRITERIA = [
  { label: "Research quality", description: "Rigour, method, and depth of the work.", weight: 30, max_score: 5 },
  { label: "Visual clarity", description: "Is the poster readable and well organised?", weight: 20, max_score: 5 },
  { label: "Oral presentation", description: "Clarity and confidence of the explanation.", weight: 30, max_score: 5 },
  { label: "Q&A handling", description: "Depth of understanding under questioning.", weight: 20, max_score: 5 },
];

const POSTERS = [
  { aisle: "A", title: "Nanofluidic sensors for trace metals", presenters: ["Amara Osei"] },
  { aisle: "A", title: "CRISPR off-target effects in maize", presenters: ["Ben Fletcher", "Lucia Marín"] },
  { aisle: "A", title: "Urban heat islands in mid-size cities", presenters: ["Priya Raman"] },
  { aisle: "A", title: "Quantum dot LEDs at low temperature", presenters: ["Tomás Ibarra"] },
  { aisle: "B", title: "Microbiome shifts under fasting diets", presenters: ["Nadia Haddad"] },
  { aisle: "B", title: "Perovskite solar cell degradation", presenters: ["Owen Whitfield"] },
  { aisle: "B", title: "Graph neural nets for traffic flow", presenters: ["Sofia Kowalski", "Dev Patel"] },
  { aisle: "B", title: "Acoustic monitoring of bat colonies", presenters: ["Marcus Lindqvist"] },
  { aisle: "C", title: "Ferroelectric memory switching speed", presenters: ["Hana Sato"] },
  { aisle: "C", title: "Wetland carbon sequestration rates", presenters: ["Isabel Ferreira"] },
  { aisle: "C", title: "Low-cost prosthetic gait analysis", presenters: ["Kwame Boateng"] },
  { aisle: "C", title: "Antibiotic resistance in river systems", presenters: ["Elena Vasquez", "Jon Park"] },
];

const JUDGE_NAMES = [
  "Dr. Farrah Nazir",
  "Dr. Peter Achebe",
  "Prof. Mei-Lin Chen",
  "Dr. Roland Dupont",
  "Prof. Sarah Okonkwo",
];

async function main() {
  console.log("Seeding demo event...\n");

  // Cascades to posters, judges, criteria, assignments and submissions.
  await db.from("events").delete().eq("slug", SLUG);

  const { data: event, error: eventError } = await db
    .from("events")
    .insert({
      name: "Demo Research Expo",
      slug: SLUG,
      status: "active",
      target_judges_per_poster: TARGET_JUDGES_PER_POSTER,
    })
    .select()
    .single();
  if (eventError) throw eventError;

  const { error: criteriaError } = await db.from("criteria").insert(
    CRITERIA.map((c, i) => ({ ...c, event_id: event.id, sort_order: i })),
  );
  if (criteriaError) throw criteriaError;

  const { data: posters, error: posterError } = await db
    .from("posters")
    .insert(
      POSTERS.map((p, i) => ({
        event_id: event.id,
        code: `${p.aisle}-${String(i + 1).padStart(2, "0")}`,
        title: p.title,
        presenter_names: p.presenters,
        location: p.aisle,
      })),
    )
    .select();
  if (posterError) throw posterError;

  // Generate a code per judge, keep the plaintext in memory only long enough to print it.
  const plaintext = new Map<string, string>();
  const judgeRows = JUDGE_NAMES.map((name) => {
    const code = generateCode();
    plaintext.set(name, code);
    return {
      event_id: event.id,
      name,
      code_hash: hashCode(code, pepper),
      code_hint: codeHint(code),
    };
  });

  const { data: judges, error: judgeError } = await db
    .from("judges")
    .insert(judgeRows)
    .select();
  if (judgeError) throw judgeError;

  const plan = autoAssign(
    posters.map((p) => ({ id: p.id, code: p.code, location: p.location })),
    judges.map((j) => j.id),
    TARGET_JUDGES_PER_POSTER,
  );

  const { error: assignError } = await db.from("assignments").insert(
    plan.map((a) => ({
      event_id: event.id,
      judge_id: a.judgeId,
      poster_id: a.posterId,
      sort_order: a.sortOrder,
    })),
  );
  if (assignError) throw assignError;

  const loads = loadPerJudge(plan);
  const byId = new Map(judges.map((j) => [j.id, j.name]));

  console.log(`Event      ${event.name} (${event.status})`);
  console.log(`Posters    ${posters.length}`);
  console.log(`Criteria   ${CRITERIA.length}`);
  console.log(`Coverage   ${TARGET_JUDGES_PER_POSTER} judges per poster\n`);
  console.log("Judge access codes — these are shown once and stored only as hashes:\n");

  for (const judge of judges) {
    const code = plaintext.get(judge.name)!;
    const load = loads.get(judge.id) ?? 0;
    console.log(
      `  ${formatCode(code)}   ${byId.get(judge.id)!.padEnd(22)} ${load} posters`,
    );
  }

  console.log("\nSign in at http://localhost:3000 with any code above.");
}

main().catch((error) => {
  console.error("\nSeed failed:", error.message ?? error);
  process.exit(1);
});

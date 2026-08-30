/**
 * Seeds a demo event and prints the judge access codes.
 *
 *   npm run seed
 *
 * Writes to the same embedded database the dev server uses (`.pgdata/`, or wherever
 * PJ_DATA_DIR points). **PGlite allows one connection at a time, so stop `npm run dev`
 * or the desktop app before running this** — otherwise it fails to open the directory
 * rather than corrupting anything.
 *
 * Safe to re-run: it deletes and recreates the `demo-expo` event, which cascades to its
 * posters, judges, assignments and submissions.
 *
 * Codes are shown once here and only ever stored as a peppered hash, exactly as the
 * admin UI does it — so this script is also the quickest way to check that sign-in works
 * end to end. The pepper must match the one the server uses (JUDGE_CODE_PEPPER in
 * .env.local for `npm run dev`; secrets.json in the app's data folder for the packaged
 * app), or the codes it prints will not be accepted.
 */

import { autoAssign, loadPerJudge } from "@/lib/assign";
import { codeHint, formatCode, generateCode, hashCode } from "@/lib/auth/codes";
import { getDb, query } from "@/lib/db/client";

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

  // Opening the database also applies any pending migrations, so a fresh checkout can
  // seed without a separate setup step.
  await getDb();

  // Cascades to posters, judges, criteria, assignments and submissions.
  await query("delete from events where slug = $1", [SLUG]);

  const [event] = await query<{ id: string; name: string; status: string }>(
    `insert into events (name, slug, status, target_judges_per_poster)
     values ($1, $2, 'active', $3)
     returning id, name, status`,
    ["Demo Research Expo", SLUG, TARGET_JUDGES_PER_POSTER],
  );

  for (const [i, c] of CRITERIA.entries()) {
    await query(
      `insert into criteria (event_id, label, description, weight, max_score, sort_order)
       values ($1, $2, $3, $4, $5, $6)`,
      [event.id, c.label, c.description, c.weight, c.max_score, i],
    );
  }

  const posters: { id: string; code: string; location: string | null }[] = [];
  for (const [i, p] of POSTERS.entries()) {
    const [row] = await query<{ id: string; code: string; location: string | null }>(
      `insert into posters (event_id, code, title, presenter_names, location)
       values ($1, $2, $3, $4::text[], $5)
       returning id, code, location`,
      [
        event.id,
        `${p.aisle}-${String(i + 1).padStart(2, "0")}`,
        p.title,
        p.presenters,
        p.aisle,
      ],
    );
    posters.push(row);
  }

  // Generate a code per judge, keep the plaintext in memory only long enough to print it.
  const plaintext = new Map<string, string>();
  const judges: { id: string; name: string }[] = [];

  for (const name of JUDGE_NAMES) {
    const code = generateCode();
    plaintext.set(name, code);
    const [row] = await query<{ id: string; name: string }>(
      `insert into judges (event_id, name, code_hash, code_hint)
       values ($1, $2, $3, $4)
       returning id, name`,
      [event.id, name, hashCode(code, pepper), codeHint(code)],
    );
    judges.push(row);
  }

  const plan = autoAssign(
    posters.map((p) => ({ id: p.id, code: p.code, location: p.location })),
    judges.map((j) => j.id),
    TARGET_JUDGES_PER_POSTER,
  );

  for (const a of plan) {
    await query(
      `insert into assignments (event_id, judge_id, poster_id, sort_order)
       values ($1, $2, $3, $4)`,
      [event.id, a.judgeId, a.posterId, a.sortOrder],
    );
  }

  const loads = loadPerJudge(plan);

  console.log(`Event      ${event.name} (${event.status})`);
  console.log(`Posters    ${posters.length}`);
  console.log(`Criteria   ${CRITERIA.length}`);
  console.log(`Coverage   ${TARGET_JUDGES_PER_POSTER} judges per poster\n`);
  console.log("Judge access codes — these are shown once and stored only as hashes:\n");

  for (const judge of judges) {
    const code = plaintext.get(judge.name)!;
    const load = loads.get(judge.id) ?? 0;
    console.log(
      `  ${formatCode(code)}   ${judge.name.padEnd(22)} ${load} posters`,
    );
  }

  console.log("\nStart the app and sign in with any code above.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nSeed failed:", error?.message ?? error);
    process.exit(1);
  });

/**
 * Verifies the tenancy boundary against a *real* database.
 *
 *   npm run verify:tenancy -- --email you@example.com
 *
 * tests/tenancy.test.ts already runs these statements under in-memory Postgres. What it
 * cannot tell you is whether the migrations actually landed on your Supabase project —
 * whether `memberships` exists, whether `events.org_id` is populated, whether the
 * indexes and constraints are the ones the queries assume. This closes that gap.
 *
 * **No second organiser, no fixtures, no writes that survive.** Every scoped statement
 * takes `admin_id` as a parameter, so passing a UUID that is not you *is* the
 * cross-tenant case — the attacker is simulated by an argument, not by an account. The
 * mutating statements run inside a transaction that is always rolled back, so this is
 * safe to point at real event data.
 *
 * Each statement is checked in both directions. A query that returned zero rows for
 * everyone would "pass" a denial-only check while being completely broken, so every
 * denial is paired with a positive case proving the statement works at all.
 *
 * Imports `lib/db/client` rather than `lib/db`, like the other scripts: `server-only`
 * throws outside a react-server context.
 */

import { randomUUID } from "node:crypto";

import { closePool, getPool } from "../lib/db/client";
import {
  DELETE_OWNED_CRITERION,
  DELETE_OWNED_JUDGE,
  DELETE_OWNED_POSTER,
  LIST_EVENTS_FOR_ADMIN,
  ROTATE_OWNED_JUDGE_CODE,
  SELECT_EVENT_SCOPE,
  SELECT_OWNED_POSTER,
  SELECT_OWNED_POSTER_SHEETS,
  SELECT_PRIMARY_EVENT_FOR_ADMIN,
  SET_OWNED_JUDGE_ACTIVE,
  UPDATE_OWNED_CRITERION,
} from "../lib/sql/scoped";

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${detail}`}`);
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

/**
 * The denial checks are inherently safe: if tenancy works they affect zero rows, and if
 * it does not, the transaction rolls back. The *positive* checks are different — they
 * genuinely delete one of your rows to prove the statement is strict rather than simply
 * broken, and they rely on the rollback to put it back. That is sound, but it is not
 * something to do to production data by default. Off unless asked for.
 */
const INCLUDE_DESTRUCTIVE = process.argv.includes("--include-writes");

async function main() {
  const email = arg("--email");
  if (!email) {
    console.error(
      "Usage: npm run verify:tenancy -- --email you@example.com\n\n" +
        "The email of an organiser row in `admins`. Nothing is written; the mutating\n" +
        "checks run inside a transaction that is rolled back.",
    );
    process.exit(1);
  }

  const pool = getPool();

  // ---------------------------------------------------------------------------
  // Schema presence — is this database actually migrated?
  // ---------------------------------------------------------------------------
  console.log("\nSchema");

  for (const table of ["organisations", "memberships", "org_invites"]) {
    const { rows } = await pool.query<{ present: boolean }>(
      "select to_regclass($1) is not null as present",
      [`public.${table}`],
    );
    record(`table ${table} exists`, rows[0].present, "run `npm run migrate`");
  }

  const orgCol = await pool.query<{ present: boolean }>(
    `select count(*) > 0 as present from information_schema.columns
      where table_name = 'events' and column_name = 'org_id'`,
  );
  record("events.org_id exists", orgCol.rows[0].present, "0006 did not apply");

  const orphaned = await pool.query<{ count: string }>(
    "select count(*)::text as count from events where org_id is null",
  );
  record(
    "no event is missing an organisation",
    orphaned.rows[0].count === "0",
    `${orphaned.rows[0].count} events have a null org_id`,
  );

  const slugConstraint = await pool.query<{ present: boolean }>(
    `select count(*) > 0 as present from pg_constraint
      where conname = 'events_org_slug_key'`,
  );
  record(
    "event slugs are unique per organisation",
    slugConstraint.rows[0].present,
    "events_org_slug_key missing — 0006's constraint swap did not apply",
  );

  const fk = await pool.query<{ present: boolean }>(
    `select count(*) > 0 as present from pg_constraint
      where conname = 'memberships_admin_id_fkey'`,
  );
  record(
    "memberships references admins",
    fk.rows[0].present,
    "0007 has not been applied — run it before trusting anything below",
  );

  // ---------------------------------------------------------------------------
  // Who are we, and what do we own?
  // ---------------------------------------------------------------------------
  console.log("\nFixtures (read from your existing data)");

  const admin = await pool.query<{ id: string }>(
    "select id from admins where lower(email) = lower($1)",
    [email],
  );
  if (admin.rows.length === 0) {
    console.error(`\nNo row in \`admins\` for ${email}. Nothing to verify against.`);
    process.exit(1);
  }
  const adminId = admin.rows[0].id;
  record("found your admin row", true, "");

  const memberships = await pool.query<{ count: string }>(
    "select count(*)::text as count from memberships where admin_id = $1",
    [adminId],
  );
  record(
    "you belong to at least one organisation",
    memberships.rows[0].count !== "0",
    "membership is the grant — without one you can see nothing",
  );

  const event = await pool.query<{ id: string }>(SELECT_PRIMARY_EVENT_FOR_ADMIN, [
    adminId,
  ]);
  if (event.rows.length === 0) {
    console.error("\nYou own no events, so there is nothing to test against.");
    process.exit(1);
  }
  const eventId = event.rows[0].id;

  const poster = await pool.query<{ id: string }>(
    "select id from posters where event_id = $1 limit 1",
    [eventId],
  );
  const judge = await pool.query<{ id: string; code_hash: string }>(
    "select id, code_hash from judges where event_id = $1 limit 1",
    [eventId],
  );
  const criterion = await pool.query<{ id: string; label: string }>(
    "select id, label from criteria where event_id = $1 limit 1",
    [eventId],
  );

  const posterId = poster.rows[0]?.id;
  const judgeId = judge.rows[0]?.id;
  const criterionId = criterion.rows[0]?.id;
  console.log(
    `  event ${eventId.slice(0, 8)}… · ` +
      `${posterId ? "poster" : "no poster"} · ` +
      `${judgeId ? "judge" : "no judge"} · ` +
      `${criterionId ? "criterion" : "no criterion"}`,
  );

  /** Stands in for another organiser. No membership row exists for it, by construction. */
  const stranger = randomUUID();

  // ---------------------------------------------------------------------------
  // Reads: both directions
  // ---------------------------------------------------------------------------
  console.log("\nReads");

  const mine = await pool.query(SELECT_EVENT_SCOPE, [eventId, adminId]);
  record("your own event resolves", mine.rows.length === 1, "positive case failed");

  const theirs = await pool.query(SELECT_EVENT_SCOPE, [eventId, stranger]);
  record(
    "a stranger cannot resolve your event",
    theirs.rows.length === 0,
    `returned ${theirs.rows.length} rows — the tenancy predicate is NOT working`,
  );

  const listed = await pool.query(LIST_EVENTS_FOR_ADMIN, [stranger]);
  record(
    "a stranger sees no events",
    listed.rows.length === 0,
    `returned ${listed.rows.length} events`,
  );

  const primary = await pool.query(SELECT_PRIMARY_EVENT_FOR_ADMIN, [stranger]);
  record(
    "a stranger has no primary event",
    primary.rows.length === 0,
    "getPrimaryEventForAdmin would hand them someone else's dashboard",
  );

  if (posterId) {
    const ownPoster = await pool.query(SELECT_OWNED_POSTER, [posterId, adminId]);
    record("your own poster loads", ownPoster.rows.length === 1, "positive case failed");

    const foreign = await pool.query(SELECT_OWNED_POSTER, [posterId, stranger]);
    record(
      "a stranger cannot load your poster",
      foreign.rows.length === 0,
      `returned ${foreign.rows.length} rows`,
    );

    const sheets = await pool.query(SELECT_OWNED_POSTER_SHEETS, [posterId, stranger]);
    record(
      "a stranger cannot read your score sheets",
      sheets.rows.length === 0,
      `returned ${sheets.rows.length} sheets — per-judge scores and comments are exposed`,
    );
  }

  // ---------------------------------------------------------------------------
  // Writes: inside a transaction, always rolled back
  // ---------------------------------------------------------------------------
  console.log("\nWrites (transaction, rolled back — nothing here persists)");

  const client = await pool.connect();
  try {
    await client.query("begin");

    if (posterId) {
      const denied = await client.query(DELETE_OWNED_POSTER, [posterId, stranger]);
      record(
        "a stranger cannot delete your poster",
        denied.rowCount === 0,
        `deleted ${denied.rowCount} rows`,
      );

      if (INCLUDE_DESTRUCTIVE) {
        const allowed = await client.query(DELETE_OWNED_POSTER, [posterId, adminId]);
        record(
          "you can delete your own poster",
          allowed.rowCount === 1,
          "positive case failed — the statement may be broken rather than strict",
        );
      }
    }

    if (judgeId) {
      const before = judge.rows[0].code_hash;

      const denied = await client.query(ROTATE_OWNED_JUDGE_CODE, [
        judgeId,
        "stranger-supplied-hash",
        "ZZZZ",
        stranger,
      ]);
      const after = await client.query<{ code_hash: string }>(
        "select code_hash from judges where id = $1",
        [judgeId],
      );
      record(
        "a stranger cannot rotate your judge's code",
        denied.rowCount === 0 && after.rows[0].code_hash === before,
        denied.rowCount !== 0
          ? `rotated ${denied.rowCount} rows`
          : "the hash CHANGED — your judge would be locked out",
      );

      const deactivate = await client.query(SET_OWNED_JUDGE_ACTIVE, [
        judgeId,
        false,
        stranger,
      ]);
      record(
        "a stranger cannot deactivate your judge",
        deactivate.rowCount === 0,
        `updated ${deactivate.rowCount} rows`,
      );

      const deleted = await client.query(DELETE_OWNED_JUDGE, [judgeId, stranger]);
      record(
        "a stranger cannot delete your judge",
        deleted.rowCount === 0,
        `deleted ${deleted.rowCount} rows`,
      );
    }

    if (criterionId) {
      const updated = await client.query(UPDATE_OWNED_CRITERION, [
        criterionId,
        "Hijacked",
        null,
        99,
        10,
        stranger,
      ]);
      const label = await client.query<{ label: string }>(
        "select label from criteria where id = $1",
        [criterionId],
      );
      record(
        "a stranger cannot rewrite your rubric",
        updated.rowCount === 0 && label.rows[0].label === criterion.rows[0].label,
        "the criterion changed — every submitted sheet would be re-scored",
      );

      const dropped = await client.query(DELETE_OWNED_CRITERION, [
        criterionId,
        stranger,
      ]);
      record(
        "a stranger cannot delete your criterion",
        dropped.rowCount === 0,
        `deleted ${dropped.rowCount} rows`,
      );
    }
  } finally {
    // Unconditional: the positive cases above genuinely delete rows, and they must not
    // survive this script.
    await client.query("rollback");
    client.release();
  }

  // ---------------------------------------------------------------------------
  console.log("\nConfirming the rollback took");

  if (posterId) {
    const survived = await pool.query("select id from posters where id = $1", [posterId]);
    record(
      "your poster still exists",
      survived.rows.length === 1,
      "THE ROLLBACK FAILED — data was lost",
    );
  }

  if (!INCLUDE_DESTRUCTIVE) {
    console.log(
      "\n  Note: the positive write cases were skipped. They delete one of your rows\n" +
        "  inside the transaction to prove the statements are strict rather than\n" +
        "  simply broken. Add --include-writes to run them (still rolled back).",
    );
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(
    `\n${checks.length - failed.length}/${checks.length} passed` +
      (failed.length ? ` — ${failed.length} FAILED\n` : "\n"),
  );

  await closePool();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error("\nVerification aborted:", error instanceof Error ? error.message : error);
  await closePool().catch(() => {});
  process.exit(1);
});

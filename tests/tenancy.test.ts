import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

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
} from "@/lib/sql/scoped";

/**
 * The tenancy boundary, exercised against real Postgres.
 *
 * Every assertion runs the **exact string** the application runs, imported from
 * lib/sql/scoped.ts. That is the whole reason those queries live in a pure module: a
 * test that re-typed them would prove something about the copy and nothing about the
 * code that ships.
 *
 * This is possible at all because 0006 keeps `memberships.admin_id` a bare uuid, with
 * the foreign key to `admins` deferred to 0007 (the Supabase-only lane). PGlite has no
 * `auth.users`, so if membership lived over there, the one part of the system that must
 * never regress would be the one part with no coverage.
 *
 * Two organisations, one admin each, one event each. Org A is the victim throughout;
 * admin B is the attacker holding a valid session and a guessed UUID.
 */

const MIGRATIONS = [
  "0001_init",
  "0002_views",
  "0003_save_submission",
  "0005_login_attempts_by_code",
  "0006_organisations",
];

let db: PGlite;

const ADMIN_A = "11111111-1111-1111-1111-111111111111";
const ADMIN_B = "22222222-2222-2222-2222-222222222222";
/** Signed in, but a member of nothing. */
const ADMIN_ORPHAN = "33333333-3333-3333-3333-333333333333";

type Fixture = {
  orgId: string;
  eventId: string;
  posterId: string;
  judgeId: string;
  criterionId: string;
};

let a: Fixture;
let b: Fixture;

async function seedOrg(name: string, adminId: string): Promise<Fixture> {
  const org = await db.query<{ id: string }>(
    "insert into organisations (name, slug) values ($1, $2) returning id",
    [name, name.toLowerCase()],
  );
  const orgId = org.rows[0].id;

  await db.query(
    "insert into memberships (org_id, admin_id, role) values ($1, $2, 'owner')",
    [orgId, adminId],
  );

  const event = await db.query<{ id: string }>(
    `insert into events (org_id, name, slug, status)
     values ($1, $2, 'expo-2026', 'active') returning id`,
    [orgId, `${name} Expo`],
  );
  const eventId = event.rows[0].id;

  const poster = await db.query<{ id: string }>(
    "insert into posters (event_id, code, title) values ($1, 'A-01', $2) returning id",
    [eventId, `${name} poster`],
  );
  const judge = await db.query<{ id: string }>(
    `insert into judges (event_id, name, code_hash, code_hint)
     values ($1, $2, $3, 'ABCD') returning id`,
    [eventId, `${name} judge`, `hash-${name}`],
  );
  const criterion = await db.query<{ id: string }>(
    `insert into criteria (event_id, label, weight, max_score)
     values ($1, 'Research', 30, 5) returning id`,
    [eventId],
  );

  return {
    orgId,
    eventId,
    posterId: poster.rows[0].id,
    judgeId: judge.rows[0].id,
    criterionId: criterion.rows[0].id,
  };
}

before(async () => {
  db = new PGlite();
  for (const name of MIGRATIONS) {
    await db.exec(readFileSync(`supabase/migrations/${name}.sql`, "utf8"));
  }

  a = await seedOrg("Alpha", ADMIN_A);
  b = await seedOrg("Beta", ADMIN_B);
});

after(async () => {
  await db.close();
});

/** Rows returned by one of the scoped statements, run as `adminId`. */
async function run(sql: string, params: unknown[]): Promise<unknown[]> {
  const result = await db.query(sql, params);
  return result.rows;
}

describe("scope resolution", () => {
  it("resolves an event for an admin whose org owns it", async () => {
    const rows = await run(SELECT_EVENT_SCOPE, [a.eventId, ADMIN_A]);
    assert.equal(rows.length, 1);
  });

  it("refuses an event belonging to another organisation", async () => {
    const rows = await run(SELECT_EVENT_SCOPE, [a.eventId, ADMIN_B]);
    assert.equal(rows.length, 0);
  });

  it("refuses an admin who belongs to no organisation", async () => {
    const rows = await run(SELECT_EVENT_SCOPE, [a.eventId, ADMIN_ORPHAN]);
    assert.equal(rows.length, 0);
  });

  it("gives each admin their own primary event, not one global one", async () => {
    const forA = await run(SELECT_PRIMARY_EVENT_FOR_ADMIN, [ADMIN_A]);
    const forB = await run(SELECT_PRIMARY_EVENT_FOR_ADMIN, [ADMIN_B]);

    assert.equal((forA[0] as { id: string }).id, a.eventId);
    assert.equal((forB[0] as { id: string }).id, b.eventId);
  });

  it("lists only the caller's own events", async () => {
    const rows = (await run(LIST_EVENTS_FOR_ADMIN, [ADMIN_A])) as { id: string }[];
    assert.deepEqual(
      rows.map((r) => r.id),
      [a.eventId],
    );
  });

  it("gives an orphan admin no events at all", async () => {
    assert.equal((await run(LIST_EVENTS_FOR_ADMIN, [ADMIN_ORPHAN])).length, 0);
  });
});

describe("cross-tenant reads", () => {
  it("refuses to load another org's poster", async () => {
    assert.equal((await run(SELECT_OWNED_POSTER, [a.posterId, ADMIN_B])).length, 0);
    assert.equal((await run(SELECT_OWNED_POSTER, [a.posterId, ADMIN_A])).length, 1);
  });

  it("refuses to load another org's score sheets", async () => {
    // A submitted sheet exists to be leaked, so the empty result is a real denial
    // rather than an artefact of there being nothing to return.
    await db.query("select save_submission($1,$2,$3,$4,$5::jsonb)", [
      a.judgeId,
      a.posterId,
      "submitted",
      "",
      JSON.stringify({ [a.criterionId]: 4 }),
    ]);

    assert.equal(
      (await run(SELECT_OWNED_POSTER_SHEETS, [a.posterId, ADMIN_A])).length,
      1,
    );
    assert.equal(
      (await run(SELECT_OWNED_POSTER_SHEETS, [a.posterId, ADMIN_B])).length,
      0,
    );
  });
});

describe("cross-tenant writes leave the target untouched", () => {
  it("refuses to delete another org's poster", async () => {
    const rows = await run(DELETE_OWNED_POSTER, [a.posterId, ADMIN_B]);
    assert.equal(rows.length, 0);

    const survivors = await db.query("select id from posters where id = $1", [
      a.posterId,
    ]);
    assert.equal(survivors.rows.length, 1, "poster must survive the denied delete");
  });

  it("refuses to delete another org's judge", async () => {
    const rows = await run(DELETE_OWNED_JUDGE, [a.judgeId, ADMIN_B]);
    assert.equal(rows.length, 0);

    const survivors = await db.query("select id from judges where id = $1", [a.judgeId]);
    assert.equal(survivors.rows.length, 1, "judge must survive the denied delete");
  });

  it("refuses to deactivate another org's judge", async () => {
    const rows = await run(SET_OWNED_JUDGE_ACTIVE, [a.judgeId, false, ADMIN_B]);
    assert.equal(rows.length, 0);

    const after = await db.query<{ active: boolean }>(
      "select active from judges where id = $1",
      [a.judgeId],
    );
    assert.equal(after.rows[0].active, true, "judge must still be active");
  });

  it("refuses to update another org's criterion", async () => {
    const rows = await run(UPDATE_OWNED_CRITERION, [
      a.criterionId,
      "Hijacked",
      null,
      99,
      10,
      ADMIN_B,
    ]);
    assert.equal(rows.length, 0);

    const after = await db.query<{ label: string }>(
      "select label from criteria where id = $1",
      [a.criterionId],
    );
    assert.equal(after.rows[0].label, "Research", "label must be unchanged");
  });

  it("refuses to delete another org's criterion", async () => {
    const rows = await run(DELETE_OWNED_CRITERION, [a.criterionId, ADMIN_B]);
    assert.equal(rows.length, 0);

    const survivors = await db.query("select id from criteria where id = $1", [
      a.criterionId,
    ]);
    assert.equal(survivors.rows.length, 1);
  });

  /**
   * The privilege-escalation case, and the reason to assert on the data rather than the
   * row count. Unscoped, this handed the caller a working plaintext code for someone
   * else's judge *and* locked that judge out, because the old hash was overwritten and
   * the plaintext was never stored anywhere.
   */
  it("refuses to rotate another org's judge code, and leaves the hash intact", async () => {
    const before = await db.query<{ code_hash: string; code_hint: string }>(
      "select code_hash, code_hint from judges where id = $1",
      [a.judgeId],
    );

    const rows = await run(ROTATE_OWNED_JUDGE_CODE, [
      a.judgeId,
      "attacker-supplied-hash",
      "ZZZZ",
      ADMIN_B,
    ]);
    assert.equal(rows.length, 0);

    const after = await db.query<{ code_hash: string; code_hint: string }>(
      "select code_hash, code_hint from judges where id = $1",
      [a.judgeId],
    );
    assert.equal(
      after.rows[0].code_hash,
      before.rows[0].code_hash,
      "the victim's code must still work",
    );
    assert.equal(after.rows[0].code_hint, before.rows[0].code_hint);
  });

  it("still allows the owning admin to rotate their own judge's code", async () => {
    const rows = await run(ROTATE_OWNED_JUDGE_CODE, [
      a.judgeId,
      "rotated-hash",
      "WXYZ",
      ADMIN_A,
    ]);
    assert.equal(rows.length, 1);

    const after = await db.query<{ code_hash: string }>(
      "select code_hash from judges where id = $1",
      [a.judgeId],
    );
    assert.equal(after.rows[0].code_hash, "rotated-hash");
  });
});

/**
 * 0007 is the Supabase-only lane and cannot be run in the main fixture — it references
 * `admins`, which lives in 0004 and needs `auth.users`. Shimming just the `admins`
 * table is enough to execute 0007 verbatim, which covers the upgrade path that would
 * otherwise be discovered on a live database on event morning.
 */
describe("0007 upgrade path", () => {
  async function freshWith0007() {
    const up = new PGlite();
    for (const name of MIGRATIONS) {
      up.exec(readFileSync(`supabase/migrations/${name}.sql`, "utf8"));
    }
    // Stands in for the `admins` table that 0004 creates on a real Supabase project.
    await up.exec(`create table admins (
      id uuid primary key,
      email text not null,
      name text,
      created_at timestamptz not null default now())`);
    return up;
  }

  it("backfills an existing organiser as owner of the existing org", async () => {
    const up = await freshWith0007();

    const admin = await up.query<{ id: string }>(
      "insert into admins (id, email) values (gen_random_uuid(), 'you@example.com') returning id",
    );
    const org = await up.query<{ id: string }>(
      "insert into organisations (name, slug) values ('Pre', 'default') returning id",
    );
    await up.query("insert into events (org_id, name, slug) values ($1, 'Pre', 'pre')", [
      org.rows[0].id,
    ]);

    await up.exec(readFileSync("supabase/migrations/0007_org_membership.sql", "utf8"));

    const rows = await up.query<{ admin_id: string; role: string }>(
      "select admin_id, role from memberships",
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].admin_id, admin.rows[0].id);
    assert.equal(rows.rows[0].role, "owner", "an existing organiser must not lose access");

    await up.close();
  });

  it("creates the bootstrap org for a project with organisers but no events", async () => {
    const up = await freshWith0007();
    await up.query(
      "insert into admins (id, email) values (gen_random_uuid(), 'solo@example.com')",
    );

    // 0006 only mints the default org when events exist, so this is 0007's job.
    await up.exec(readFileSync("supabase/migrations/0007_org_membership.sql", "utf8"));

    const orgs = await up.query("select id from organisations where slug = 'default'");
    assert.equal(orgs.rows.length, 1);
    assert.equal((await up.query("select 1 from memberships")).rows.length, 1);

    await up.close();
  });

  it("enforces the foreign key onto admins once applied", async () => {
    const up = await freshWith0007();
    const org = await up.query<{ id: string }>(
      "insert into organisations (name, slug) values ('Pre', 'default') returning id",
    );
    await up.exec(readFileSync("supabase/migrations/0007_org_membership.sql", "utf8"));

    await assert.rejects(
      () =>
        up.query("insert into memberships (org_id, admin_id) values ($1, $2)", [
          org.rows[0].id,
          "44444444-4444-4444-4444-444444444444",
        ]),
      /memberships_admin_id_fkey/,
      "a membership must not survive without a matching admin",
    );

    await up.close();
  });
});

describe("per-organisation slugs", () => {
  it("lets two organisations run an event with the same slug", async () => {
    // Both fixtures above already used the slug 'expo-2026' in different orgs; if the
    // constraint were still global, seeding would have failed before any test ran.
    const rows = await db.query<{ count: string }>(
      "select count(*)::text as count from events where slug = 'expo-2026'",
    );
    assert.equal(rows.rows[0].count, "2");
  });

  it("still rejects a duplicate slug inside one organisation", async () => {
    await assert.rejects(
      () =>
        db.query(
          `insert into events (org_id, name, slug) values ($1, 'Clash', 'expo-2026')`,
          [a.orgId],
        ),
      /events_org_slug_key/,
    );
  });
});

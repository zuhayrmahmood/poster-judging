import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A lint rule wearing a test's clothes.
 *
 * Every admin Server Action must hand its work to a service in lib/services/, because
 * that is where ownership is decided. An action that queries the database directly is
 * an action that has to remember to check tenancy on its own — and the entire reason
 * this codebase needed a multi-tenancy project is that eighteen of them forgot.
 *
 * This does not prove any particular check is correct; tests/tenancy.test.ts does that,
 * against the real SQL. What this catches is the regression that reintroduces the
 * original bug class: someone adding a nineteenth action six months from now, wiring it
 * straight to `query()`, and nobody noticing until a second organiser does.
 */

const ACTIONS_FILE = "app/actions/admin.ts";

/**
 * Actions that legitimately touch no tenant-scoped data. Keep this list short and
 * justify every entry — it is the escape hatch that could quietly swallow a real bug.
 */
const NO_TENANT_DATA = new Set([
  // Ends the Supabase session. Reads and writes nothing owned by an organisation.
  "adminSignOut",
]);

/** Namespace imports of the service modules, as used in app/actions/admin.ts. */
const SERVICE_CALL = /\b(events|posters|judges|criteria|assignments)\.\w+\(/;

/** Anything that reaches the database without going through a service. */
const DIRECT_DB = /\b(query|one|transaction)\s*(<[^>]*>)?\s*\(/;

type Action = { name: string; body: string };

function parseActions(source: string): Action[] {
  const header = /export async function (\w+)\s*\(/g;
  const starts: { name: string; index: number }[] = [];

  for (const match of source.matchAll(header)) {
    starts.push({ name: match[1], index: match.index });
  }

  return starts.map((start, i) => ({
    name: start.name,
    body: source.slice(start.index, starts[i + 1]?.index ?? source.length),
  }));
}

describe("admin server actions delegate to the service layer", () => {
  const source = readFileSync(ACTIONS_FILE, "utf8");
  const actions = parseActions(source);

  it("finds the actions at all, so a rename cannot silently empty this suite", () => {
    assert.ok(
      actions.length >= 18,
      `expected at least 18 exported actions in ${ACTIONS_FILE}, found ${actions.length}`,
    );
  });

  for (const action of parseActions(readFileSync(ACTIONS_FILE, "utf8"))) {
    if (NO_TENANT_DATA.has(action.name)) continue;

    it(`${action.name} calls a service`, () => {
      assert.match(
        action.body,
        SERVICE_CALL,
        `${action.name} must delegate to lib/services/* rather than deciding ` +
          `authorization itself`,
      );
    });

    it(`${action.name} does not reach the database directly`, () => {
      assert.doesNotMatch(
        action.body,
        DIRECT_DB,
        `${action.name} calls the database directly. Ownership checks belong in a ` +
          `service, where both this action and any future Route Handler share them`,
      );
    });
  }

  it("does not import the database at all", () => {
    assert.doesNotMatch(
      source,
      /from "@\/lib\/db"/,
      `${ACTIONS_FILE} should have no database import left — every query moved into ` +
        `lib/services/*`,
    );
  });
});

describe("the scoped SQL stays importable by tests", () => {
  it("lib/sql/scoped.ts imports nothing", () => {
    const source = readFileSync("lib/sql/scoped.ts", "utf8");
    assert.doesNotMatch(
      source,
      /^\s*import\s/m,
      "lib/sql/scoped.ts must stay a pure module (no imports, no server-only) so " +
        "tests/tenancy.test.ts can run the exact strings the app runs",
    );
  });

  it("every scoped statement filters on memberships", () => {
    const source = readFileSync("lib/sql/scoped.ts", "utf8");
    const statements = source.matchAll(/export const (\w+) = `([^`]+)`/g);

    let checked = 0;
    for (const [, name, sql] of statements) {
      checked++;
      assert.match(
        sql,
        /memberships/,
        `${name} does not join memberships, so it is not tenant-scoped`,
      );
    }

    assert.ok(checked >= 10, `expected to check 10+ statements, saw ${checked}`);
  });
});

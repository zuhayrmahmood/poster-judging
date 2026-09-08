import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A lint rule wearing a test's clothes, guarding the one failure mode of Phase 4.
 *
 * Admin routes are event-scoped: `/admin/events/{eventId}/posters`, not `/admin/posters`.
 * A `revalidatePath` left pointing at the old shape does not throw, does not warn, and
 * does not show up in any type check — the write lands and the page simply never
 * refreshes. That is a bug an organiser reports as "it didn't save", which sends you
 * looking at the write path, which is fine.
 *
 * So: every revalidation target in the actions file must either be built by the
 * `eventPath()` helper or be one of the handful of genuinely event-less routes.
 */

const ACTIONS_FILE = "app/actions/admin.ts";

/** Routes that legitimately have no event in them. Keep this list short. */
const EVENTLESS = new Set(['"/admin/events"']);

describe("revalidatePath targets are event-scoped", () => {
  const source = readFileSync(ACTIONS_FILE, "utf8");

  const targets = [...source.matchAll(/revalidatePath\(\s*([^,)]+)/g)].map((m) =>
    m[1].trim(),
  );

  it("finds the revalidation calls at all", () => {
    // If this drops to zero the rest of the file passes vacuously.
    assert.ok(targets.length >= 15, `only found ${targets.length} revalidatePath calls`);
  });

  it("never hardcodes a pre-Phase-4 admin path", () => {
    for (const target of targets) {
      if (EVENTLESS.has(target)) continue;
      assert.doesNotMatch(
        target,
        /^"\/admin/,
        `${target} is a literal admin path — it must go through eventPath(), or the ` +
          `page silently stops refreshing after a write`,
      );
    }
  });

  it("routes every event-scoped revalidation through the helper", () => {
    for (const target of targets) {
      if (EVENTLESS.has(target)) continue;
      assert.match(
        target,
        /^eventPath\(/,
        `${target} should be eventPath(eventId, tab?)`,
      );
    }
  });

  it("builds paths under /admin/events/", () => {
    const helper = source.match(/function eventPath\([^)]*\)\s*\{[\s\S]*?\n\}/)?.[0];
    assert.ok(helper, "eventPath() helper is missing");
    assert.match(helper, /\/admin\/events\/\$\{eventId\}/);
  });

  it("gets the event from the service result when the action holds only a child id", () => {
    // These four take a poster/judge/criterion id and nothing else, so the only sound
    // source for the path is the row the ownership join already proved.
    for (const fn of ["deletePoster", "deleteJudge", "updateCriterion", "deleteCriterion"]) {
      const body = source.slice(source.indexOf(`export async function ${fn}(`));
      const upToReturn = body.slice(0, body.indexOf("return { error: null }"));
      assert.match(
        upToReturn,
        /eventPath\(result\.data\.eventId/,
        `${fn} must revalidate the event its service proved, not one from the caller`,
      );
    }
  });
});

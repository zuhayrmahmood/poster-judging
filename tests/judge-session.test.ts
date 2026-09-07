import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A lint rule wearing a test's clothes, guarding a redirect loop.
 *
 * The judge cookie is a self-contained 24h JWT, so it keeps verifying after an
 * organiser deletes or deactivates that judge mid-event. Two pages act on it:
 *
 *   /        redirects to /judge when the judge is signed in
 *   /judge   redirects to /      when they are not
 *
 * If those two disagree about what "signed in" means, they bounce the judge between
 * each other forever and the phone never renders anything — not the app, and not the
 * sign-in form that would let them recover. That is exactly what happened when `/`
 * trusted the token alone while `/judge` also required the judge row to exist: an
 * organiser deleting a judge bricked that judge's phone until they cleared cookies.
 *
 * The fix is that both pages call one predicate, `getLiveJudgeSession()`, which checks
 * the database. This test fails if either page goes back to deciding for itself.
 */

const ROOT_PAGE = "app/page.tsx";
const JUDGE_LAYOUT = "app/judge/layout.tsx";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("judge session: / and /judge cannot disagree", () => {
  for (const path of [ROOT_PAGE, JUDGE_LAYOUT]) {
    it(`${path} decides via getLiveJudgeSession()`, () => {
      assert.match(
        source(path),
        /getLiveJudgeSession\(\)/,
        `${path} must resolve the session through the shared predicate`,
      );
    });

    it(`${path} does not re-derive the check from the raw token`, () => {
      // getJudgeSession() reads the cookie and verifies the signature, and knows
      // nothing about whether the judge still exists. Either page gating a redirect on
      // it alone is what reopens the loop.
      assert.doesNotMatch(
        source(path),
        /getJudgeSession\(\)/,
        `${path} must not gate its redirect on the unvalidated token`,
      );
    });
  }

  it("getLiveJudgeSession rejects a deleted, deactivated or eventless judge", () => {
    const helper = source("lib/data/judge.ts");
    assert.match(helper, /export async function getLiveJudgeSession/);
    // All three conditions matter: a deleted judge, a deactivated one, and an event
    // that has gone. Dropping any one of them puts a page back in the loop.
    assert.match(
      helper,
      /if \(!judge \|\| !judge\.active \|\| !event\) return null;/,
      "the predicate must reject all three stale-session shapes",
    );
  });
});

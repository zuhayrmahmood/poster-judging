import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { autoAssign, loadPerJudge, type AssignPoster } from "@/lib/assign";

/** Three aisles of four posters each, the shape of a small real event. */
function hall(): AssignPoster[] {
  const posters: AssignPoster[] = [];
  for (const aisle of ["A", "B", "C"]) {
    for (let n = 1; n <= 4; n++) {
      posters.push({ id: `${aisle}${n}`, code: `${aisle}-0${n}`, location: aisle });
    }
  }
  return posters;
}

/** A larger hall: `aisles` aisles of `per` posters each. */
function bigHall(aisles: number, per: number): AssignPoster[] {
  const posters: AssignPoster[] = [];
  for (let a = 0; a < aisles; a++) {
    const letter = String.fromCharCode(65 + a);
    for (let n = 1; n <= per; n++) {
      const code = `${letter}-${String(n).padStart(2, "0")}`;
      posters.push({ id: code, code, location: letter });
    }
  }
  return posters;
}

const judges = ["j1", "j2", "j3", "j4", "j5"];

describe("autoAssign", () => {
  it("gives every poster exactly the target number of judges", () => {
    const plan = autoAssign(hall(), judges, 3);

    const perPoster = new Map<string, Set<string>>();
    for (const { posterId, judgeId } of plan) {
      if (!perPoster.has(posterId)) perPoster.set(posterId, new Set());
      perPoster.get(posterId)!.add(judgeId);
    }

    assert.equal(perPoster.size, 12);
    for (const [posterId, assigned] of perPoster) {
      assert.equal(assigned.size, 3, `${posterId} got ${assigned.size} judges`);
    }
  });

  it("never assigns the same judge to a poster twice", () => {
    const plan = autoAssign(hall(), judges, 3);
    const pairs = new Set(plan.map((p) => `${p.judgeId}:${p.posterId}`));
    assert.equal(pairs.size, plan.length);
  });

  it("balances workload across judges", () => {
    const plan = autoAssign(hall(), judges, 3);
    const loads = [...loadPerJudge(plan).values()];

    // 12 posters x 3 judges = 36 assignments across 5 judges.
    assert.equal(plan.length, 36);
    assert.equal(
      loads.reduce((a, b) => a + b, 0),
      36,
    );
    // Block dealing gives every judge T blocks of ~N/J, so the spread is rounding only.
    assert.ok(
      Math.max(...loads) - Math.min(...loads) <= 1,
      `load spread too wide: ${loads.join(", ")}`,
    );
  });

  it("gives each judge one unbroken run of the walking order", () => {
    // The property that makes a route walkable. Assert it directly rather than
    // counting aisles: how many aisle boundaries a run happens to cross depends on
    // aisle size, but the run itself must never be split.
    for (const [posters, judgeCount] of [
      [hall(), 5],
      [bigHall(6, 20), 20],
      [bigHall(4, 9).slice(0, 37), 7], // deliberately uneven
    ] as const) {
      const judgeIds = Array.from({ length: judgeCount }, (_, i) => `j${i}`);
      const plan = autoAssign([...posters], judgeIds, 3);

      const order = [...posters].sort((a, b) =>
        (a.location ?? "").localeCompare(b.location ?? "") ||
        a.code.localeCompare(b.code, undefined, { numeric: true }),
      );
      const indexOf = new Map(order.map((p, i) => [p.id, i]));

      for (const judgeId of judgeIds) {
        const positions = plan
          .filter((p) => p.judgeId === judgeId)
          .map((p) => indexOf.get(p.posterId)!)
          .sort((a, b) => a - b);

        let runs = 1;
        for (let i = 1; i < positions.length; i++) {
          if (positions[i] !== positions[i - 1] + 1) runs++;
        }
        // The last few judges wrap around the end of the hall; that reads as two runs
        // but is one loop, so collapse it.
        if (
          runs === 2 &&
          positions[0] === 0 &&
          positions[positions.length - 1] === order.length - 1
        ) {
          runs = 1;
        }

        assert.equal(runs, 1, `${judgeId} got ${runs} disjoint runs`);
      }
    }
  });

  it("orders each judge's list in walking order", () => {
    const plan = autoAssign(hall(), judges, 3);

    for (const judgeId of judges) {
      const mine = plan
        .filter((p) => p.judgeId === judgeId)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      // sortOrder is dense and zero-based.
      assert.deepEqual(
        mine.map((m) => m.sortOrder),
        mine.map((_, i) => i),
      );
      // ...and follows the physical layout.
      const ids = mine.map((m) => m.posterId);
      assert.deepEqual(ids, [...ids].sort());
    }
  });

  it("is deterministic, so the preview matches what gets committed", () => {
    const a = autoAssign(hall(), judges, 3);
    const b = autoAssign(hall(), judges, 3);
    assert.deepEqual(a, b);
  });

  it("clamps the target to the number of available judges", () => {
    const plan = autoAssign(hall(), ["j1", "j2"], 5);
    const perPoster = new Map<string, number>();
    for (const { posterId } of plan) {
      perPoster.set(posterId, (perPoster.get(posterId) ?? 0) + 1);
    }
    for (const count of perPoster.values()) assert.equal(count, 2);
  });

  it("handles posters with no location set", () => {
    const posters: AssignPoster[] = [
      { id: "p1", code: "1", location: null },
      { id: "p2", code: "2", location: null },
    ];
    const plan = autoAssign(posters, judges, 2);
    assert.equal(plan.length, 4);
  });

  it("returns nothing when there is nothing to assign", () => {
    assert.deepEqual(autoAssign([], judges, 3), []);
    assert.deepEqual(autoAssign(hall(), [], 3), []);
  });
});

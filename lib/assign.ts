/**
 * Auto-assignment: spread judges across posters so every poster gets seen the target
 * number of times, while keeping each judge's route physically walkable.
 *
 * Pure and dependency-free so the admin preview, the seed script and the unit tests all
 * share one implementation.
 */

export type AssignPoster = {
  id: string;
  code: string;
  location: string | null;
};

export type AssignmentPlan = {
  judgeId: string;
  posterId: string;
  sortOrder: number;
};

function byLocationThenCode(a: AssignPoster, b: AssignPoster): number {
  const locA = a.location ?? "";
  const locB = b.location ?? "";
  if (locA !== locB) return locA.localeCompare(locB);
  return a.code.localeCompare(b.code, undefined, { numeric: true });
}

/**
 * Deals contiguous blocks of the hall to judges.
 *
 * Posters are laid out in a single walking order (location, then code). That line is cut
 * into `J` equal blocks, one per judge. Poster `i` sits in block `floor(i*J/N)` and is
 * assigned to the judges owning blocks `b, b+1, ... b+T-1` (wrapping at the end).
 *
 * Two properties fall out of this, both of which matter on event day:
 *
 * - **Balanced.** Judge `j` serves exactly the blocks `j-T+1 .. j`, so every judge gets
 *   `T` blocks of roughly `N/J` posters — a load spread of at most one poster.
 * - **Contiguous.** Those `T` blocks are *adjacent*, so each judge's posters form one
 *   unbroken run of the walking order rather than being scattered across the hall.
 *
 * An earlier version of this used a greedy lowest-load pick with a bonus for staying in
 * the current aisle. Measured against realistic halls (60-120 posters) that heuristic
 * turned out to change nothing at usable bonus values, and to destroy load balance at
 * values large enough to matter. Dealing blocks gets both properties by construction
 * instead of trading one against the other.
 *
 * The wrap means the last `T-1` judges get posters from both ends of the hall. With a
 * realistic judge count that affects two or three people, and their on-phone list is
 * still sorted in walking order, so they never backtrack within a sweep.
 */
export function autoAssign(
  posters: AssignPoster[],
  judgeIds: string[],
  targetPerPoster: number,
): AssignmentPlan[] {
  if (posters.length === 0 || judgeIds.length === 0) return [];

  const judgeCount = judgeIds.length;
  // Cannot show a poster to more judges than exist.
  const target = Math.min(targetPerPoster, judgeCount);

  const walkingOrder = [...posters].sort(byLocationThenCode);
  const total = walkingOrder.length;

  const picked = new Map<string, AssignPoster[]>(judgeIds.map((id) => [id, []]));

  walkingOrder.forEach((poster, index) => {
    const block = Math.floor((index * judgeCount) / total);
    for (let k = 0; k < target; k++) {
      // k < target <= judgeCount, so these are always `target` distinct judges.
      picked.get(judgeIds[(block + k) % judgeCount])!.push(poster);
    }
  });

  const plan: AssignmentPlan[] = [];
  for (const [judgeId, assigned] of picked) {
    assigned.sort(byLocationThenCode).forEach((poster, index) => {
      plan.push({ judgeId, posterId: poster.id, sortOrder: index });
    });
  }
  return plan;
}

/** Per-judge poster counts, for the admin's pre-commit preview. */
export function loadPerJudge(plan: AssignmentPlan[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { judgeId } of plan) {
    counts.set(judgeId, (counts.get(judgeId) ?? 0) + 1);
  }
  return counts;
}

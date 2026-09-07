import { resolveJudge } from "@/lib/http/guards";
import { collection, unauthenticated } from "@/lib/http/respond";
import { getAssignmentRows } from "@/lib/data/judge";

/**
 * The judge's walking order, with each poster's submission state.
 *
 * Assignments are a suggested route, not a permission list — a judge may score any
 * poster in their own event, including one they wander to that is not on this list.
 */
export async function GET() {
  const judge = await resolveJudge();
  if (!judge) return unauthenticated();

  return collection(await getAssignmentRows(judge.judgeId));
}

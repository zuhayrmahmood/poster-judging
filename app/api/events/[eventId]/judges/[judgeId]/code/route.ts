import { requireSameOrigin, resolveAdmin } from "@/lib/http/guards";
import { fromFailure, jsonNoStore, unauthenticated } from "@/lib/http/respond";
import * as judges from "@/lib/services/judges";

/**
 * Rotates one judge's code. POST rather than PATCH because the server generates the new
 * value — the caller is asking for a code to be created, not supplying one.
 *
 * The scoped statement behind this is the privilege-escalation case that motivated the
 * whole tenancy project: unscoped, it returned a working code for someone else's judge
 * and locked that judge out at the same time.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ judgeId: string }> },
) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const { judgeId } = await params;
  const result = await judges.rotateJudgeCode(admin, judgeId);
  return result.ok
    ? jsonNoStore({ code: result.data.code }, { status: 201 })
    : fromFailure(result);
}

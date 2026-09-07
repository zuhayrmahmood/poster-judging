import { requireSameOrigin, resolveAdmin } from "@/lib/http/guards";
import { fromFailure, noContent, unauthenticated } from "@/lib/http/respond";
import { judgePatchSchema, parseJson } from "@/lib/http/schemas";
import * as judges from "@/lib/services/judges";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ judgeId: string }> },
) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const body = await parseJson(request, judgePatchSchema);
  if (!body.ok) return body.response;

  const { judgeId } = await params;
  const result = await judges.setJudgeActive(admin, judgeId, body.data.active!);
  return result.ok ? noContent() : fromFailure(result);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ judgeId: string }> },
) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const { judgeId } = await params;
  const result = await judges.deleteJudge(admin, judgeId);
  return result.ok ? noContent() : fromFailure(result);
}

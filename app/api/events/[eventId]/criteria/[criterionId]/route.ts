import { requireSameOrigin, resolveAdmin } from "@/lib/http/guards";
import { fromFailure, noContent, unauthenticated } from "@/lib/http/respond";
import { criterionSchema, parseJson } from "@/lib/http/schemas";
import * as criteria from "@/lib/services/criteria";

/**
 * PUT rather than PATCH: the body carries the whole criterion, so this replaces the
 * resource rather than merging fields into it.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ criterionId: string }> },
) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const body = await parseJson(request, criterionSchema);
  if (!body.ok) return body.response;

  const { criterionId } = await params;
  const result = await criteria.updateCriterion(admin, criterionId, {
    label: body.data.label,
    description: body.data.description ?? "",
    weight: body.data.weight,
    maxScore: body.data.max_score,
  });

  return result.ok ? noContent() : fromFailure(result);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ criterionId: string }> },
) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const { criterionId } = await params;
  const result = await criteria.deleteCriterion(admin, criterionId);
  return result.ok ? noContent() : fromFailure(result);
}

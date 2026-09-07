import { requireSameOrigin, resolveAdmin } from "@/lib/http/guards";
import { collection, created, fromFailure, unauthenticated } from "@/lib/http/respond";
import { criterionSchema, parseJson } from "@/lib/http/schemas";
import * as criteria from "@/lib/services/criteria";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const { eventId } = await params;
  const result = await criteria.listCriteria(admin, eventId);
  return result.ok ? collection(result.data) : fromFailure(result);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const body = await parseJson(request, criterionSchema);
  if (!body.ok) return body.response;

  const { eventId } = await params;
  const result = await criteria.createCriterion(admin, eventId, {
    label: body.data.label,
    description: body.data.description ?? "",
    weight: body.data.weight,
    maxScore: body.data.max_score,
  });

  return result.ok
    ? created({ label: body.data.label }, `/api/events/${eventId}/criteria`)
    : fromFailure(result);
}

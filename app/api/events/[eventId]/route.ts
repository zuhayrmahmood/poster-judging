import { requireSameOrigin, resolveAdmin } from "@/lib/http/guards";
import { fromFailure, json, unauthenticated } from "@/lib/http/respond";
import { eventPatchSchema, parseJson } from "@/lib/http/schemas";
import * as events from "@/lib/services/events";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const { eventId } = await params;
  const result = await events.getEvent(admin, eventId);
  return result.ok ? json(result.data) : fromFailure(result);
}

/**
 * Opening and closing judging happens here, as a status field. There is no /open or
 * /close endpoint: the state belongs to the event, and PATCH is how a field changes.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const body = await parseJson(request, eventPatchSchema);
  if (!body.ok) return body.response;

  const { eventId } = await params;
  const result = await events.updateEvent(admin, eventId, body.data);
  return result.ok ? json(result.data) : fromFailure(result);
}

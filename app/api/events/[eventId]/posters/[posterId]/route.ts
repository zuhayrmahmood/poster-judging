import { requireSameOrigin, resolveAdmin } from "@/lib/http/guards";
import {
  fromFailure,
  json,
  noContent,
  notFound,
  unauthenticated,
} from "@/lib/http/respond";
import * as posters from "@/lib/services/posters";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string; posterId: string }> },
) {
  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const { eventId, posterId } = await params;
  const result = await posters.getPoster(admin, posterId);
  if (!result.ok) return fromFailure(result);

  // The poster is owned, but it must also be the one this URL claims. Without this a
  // poster could be read through any event id the caller happens to own.
  if (result.data.event_id !== eventId) return notFound();

  return json(result.data);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ eventId: string; posterId: string }> },
) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const { eventId, posterId } = await params;
  const found = await posters.getPoster(admin, posterId);
  if (!found.ok) return fromFailure(found);
  if (found.data.event_id !== eventId) return notFound();

  const result = await posters.deletePoster(admin, posterId);
  return result.ok ? noContent() : fromFailure(result);
}

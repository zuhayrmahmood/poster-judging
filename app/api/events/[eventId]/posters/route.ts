import { requireSameOrigin, resolveAdmin } from "@/lib/http/guards";
import { collection, created, fromFailure, unauthenticated } from "@/lib/http/respond";
import { parseJson, posterCreateSchema } from "@/lib/http/schemas";
import * as posters from "@/lib/services/posters";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const { eventId } = await params;
  const result = await posters.listPosters(admin, eventId);
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

  const body = await parseJson(request, posterCreateSchema);
  if (!body.ok) return body.response;

  const { eventId } = await params;
  const result = await posters.createPoster(admin, eventId, {
    code: body.data.code,
    title: body.data.title,
    // The service takes the semicolon-joined form the CSV paste uses; JSON callers get
    // the natural array shape and it is normalised here rather than in two places.
    presenters: (body.data.presenter_names ?? []).join(";"),
    location: body.data.location ?? "",
  });

  return result.ok
    ? created({ code: body.data.code }, `/api/events/${eventId}/posters`)
    : fromFailure(result);
}

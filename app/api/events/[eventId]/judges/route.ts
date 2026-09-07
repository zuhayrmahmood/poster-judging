import { requireSameOrigin, resolveAdmin } from "@/lib/http/guards";
import {
  collection,
  fromFailure,
  jsonNoStore,
  unauthenticated,
} from "@/lib/http/respond";
import { judgeCreateSchema, parseJson } from "@/lib/http/schemas";
import * as judges from "@/lib/services/judges";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const { eventId } = await params;
  const result = await judges.listJudges(admin, eventId);
  // The service selects an explicit column list; code_hash never leaves the database.
  return result.ok ? collection(result.data) : fromFailure(result);
}

/**
 * Creates a judge and returns their access code in plaintext. That value exists in this
 * response and nowhere else — only the peppered hash is stored — so the response is
 * marked no-store and must never be logged.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const body = await parseJson(request, judgeCreateSchema);
  if (!body.ok) return body.response;

  const { eventId } = await params;
  const result = await judges.createJudge(
    admin,
    eventId,
    body.data.name,
    body.data.email ?? "",
  );

  return result.ok
    ? jsonNoStore(
        { name: body.data.name, code: result.data.code },
        { status: 201, headers: { Location: `/api/events/${eventId}/judges` } },
      )
    : fromFailure(result);
}

import { requireSameOrigin, resolveAdmin } from "@/lib/http/guards";
import { collection, created, fromFailure, unauthenticated } from "@/lib/http/respond";
import { eventCreateSchema, parseJson } from "@/lib/http/schemas";
import * as events from "@/lib/services/events";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const { orgId } = await params;
  const org = await events.getOrg(admin, orgId);
  if (!org.ok) return fromFailure(org);

  const all = await events.listEvents(admin);
  return collection(all.filter((event) => event.org_id === orgId));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const body = await parseJson(request, eventCreateSchema);
  if (!body.ok) return body.response;

  const { orgId } = await params;
  const result = await events.createEvent(admin, orgId, body.data.name);
  return result.ok
    ? created(result.data, `/api/events/${result.data.id}`)
    : fromFailure(result);
}

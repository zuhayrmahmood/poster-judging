import { requireSameOrigin, resolveAdmin } from "@/lib/http/guards";
import { fromFailure, json, noContent, unauthenticated } from "@/lib/http/respond";
import { orgPatchSchema, parseJson } from "@/lib/http/schemas";
import * as events from "@/lib/services/events";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const { orgId } = await params;
  const result = await events.getOrg(admin, orgId);
  return result.ok ? json(result.data) : fromFailure(result);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const body = await parseJson(request, orgPatchSchema);
  if (!body.ok) return body.response;

  const { orgId } = await params;
  const result = await events.renameOrg(admin, orgId, body.data.name);
  return result.ok ? noContent() : fromFailure(result);
}

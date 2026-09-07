import { requireSameOrigin, resolveAdmin } from "@/lib/http/guards";
import { failure, fromFailure, json, unauthenticated } from "@/lib/http/respond";
import * as posters from "@/lib/services/posters";

/**
 * Bulk import. Takes `text/csv` directly rather than a JSON-wrapped string, so the
 * request body is the file an organiser already has.
 *
 * Sits on a static `import` segment beside the dynamic `[posterId]`; Next resolves
 * static first, and a poster id is always a UUID, so the two cannot collide.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const csv = await request.text();
  if (!csv.trim()) {
    return failure("bad_request", "Expected a CSV body.", 400);
  }

  const { eventId } = await params;
  const result = await posters.importPosters(admin, eventId, csv);
  return result.ok ? json({ imported: result.data.imported }) : fromFailure(result);
}

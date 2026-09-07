import { requireSameOrigin, resolveAdmin } from "@/lib/http/guards";
import { collection, fromFailure, json, noContent, unauthenticated } from "@/lib/http/respond";
import * as assignments from "@/lib/services/assignments";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const { eventId } = await params;
  const result = await assignments.listAssignments(admin, eventId);
  return result.ok ? collection(result.data) : fromFailure(result);
}

/**
 * Auto-assign, as a collection replacement.
 *
 * PUT rather than POST because the underlying operation already deletes every
 * assignment for the event and inserts a freshly dealt plan — that *is* replacing the
 * collection, and it makes the call idempotent. Submissions are deliberately untouched:
 * a judge who already scored a poster keeps that score even if the reshuffle moves the
 * poster off their list.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const { eventId } = await params;
  const result = await assignments.runAutoAssign(admin, eventId);
  return result.ok ? json({ count: result.data.count }) : fromFailure(result);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const { eventId } = await params;
  const result = await assignments.clearAssignments(admin, eventId);
  return result.ok ? noContent() : fromFailure(result);
}

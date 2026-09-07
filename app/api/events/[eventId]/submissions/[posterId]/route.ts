import { requireSameOrigin, resolveJudge } from "@/lib/http/guards";
import {
  fromFailure,
  json,
  notFound,
  unauthenticated,
} from "@/lib/http/respond";
import { parseJson, submissionSchema } from "@/lib/http/schemas";
import * as submissions from "@/lib/services/submissions";

/**
 * Save or submit one score sheet.
 *
 * PUT is exactly right here rather than a convenient approximation: `save_submission`
 * upserts on `(judge, poster)` and replaces the child score rows wholesale, so sending
 * the same body twice leaves the same state. The offline outbox's core requirement —
 * that a replayed submission overwrite rather than double-count — and the definition of
 * PUT are the same property.
 *
 * Authenticated by the `pj_judge` cookie, not an admin session. The judge's event comes
 * from the signed token; the event id in the path is checked against it, which is a
 * boundary independent of the one save_submission enforces in SQL.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ eventId: string; posterId: string }> },
) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const judge = await resolveJudge();
  if (!judge) return unauthenticated();

  const body = await parseJson(request, submissionSchema);
  if (!body.ok) return body.response;

  const { eventId, posterId } = await params;
  // Never trust the path over the token. A judge addressing another event gets the same
  // answer as one addressing a poster that does not exist.
  if (eventId !== judge.eventId) return notFound();

  const result = await submissions.saveSubmission(
    judge,
    posterId,
    body.data.scores,
    body.data.comment ?? "",
    body.data.status,
  );

  // A rejection is a 409 the client shows inline and never queues; a thrown request is
  // what the outbox retries. Keeping those distinct is deliberate — see score-form.tsx.
  return result.ok ? json({ status: body.data.status }) : fromFailure(result);
}

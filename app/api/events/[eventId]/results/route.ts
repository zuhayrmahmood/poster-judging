import { resolveAdmin } from "@/lib/http/guards";
import { fromFailure, json, unauthenticated } from "@/lib/http/respond";
import * as results from "@/lib/services/results";

/**
 * The dashboard numbers.
 *
 * `?mode=normalized` expresses each score as how far above or below that judge's own
 * average it sits, which matters because no two posters are seen by the same set of
 * judges. A poster nobody has judged comes back with a null score and is unranked —
 * that is different from a zero, and clients must not collapse the two.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const mode =
    new URL(request.url).searchParams.get("mode") === "normalized"
      ? "normalized"
      : "raw";

  const { eventId } = await params;
  const [rows, progress] = await Promise.all([
    results.listResults(admin, eventId, mode),
    results.listJudgeProgress(admin, eventId),
  ]);

  if (!rows.ok) return fromFailure(rows);
  if (!progress.ok) return fromFailure(progress);

  return json({ mode, data: rows.data, judges: progress.data });
}

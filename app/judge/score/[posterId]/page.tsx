import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ScoreForm } from "@/components/score-form";
import { getJudgeSession } from "@/lib/auth/judge-session";
import {
  getAssignmentRows,
  getCriteria,
  getEvent,
  getPosterInEvent,
  getSubmission,
} from "@/lib/data/judge";

export const dynamic = "force-dynamic";

export default async function ScorePage({
  params,
}: PageProps<"/judge/score/[posterId]">) {
  // Next 16: params is a Promise.
  const { posterId } = await params;

  const session = await getJudgeSession();
  if (!session) redirect("/");

  // Scoped to the judge's event — this is the check that stops a poster id from another
  // event being rendered, and it mirrors the one inside save_submission.
  const poster = await getPosterInEvent(posterId, session.eventId);
  if (!poster) notFound();

  const [event, criteria, existing, rows] = await Promise.all([
    getEvent(session.eventId),
    getCriteria(session.eventId),
    getSubmission(session.judgeId, posterId),
    getAssignmentRows(session.judgeId),
  ]);

  // The next poster on their list that still needs scoring, so submitting can hand them
  // straight to it instead of bouncing back through the list.
  const nextRow = rows.find(
    (row) => row.poster.id !== posterId && row.status !== "submitted",
  );

  return (
    <div className="flex flex-col gap-5">
      <Link href="/judge" className="text-sm text-muted hover:text-ink">
        ← My posters
      </Link>

      <ScoreForm
        judgeId={session.judgeId}
        poster={poster}
        criteria={criteria}
        initialScores={existing?.scores ?? {}}
        initialComment={existing?.submission.comment ?? ""}
        serverUpdatedAt={
          existing ? new Date(existing.submission.updated_at).getTime() : null
        }
        alreadySubmitted={existing?.submission.status === "submitted"}
        locked={event?.status !== "active"}
        nextPoster={
          nextRow ? { id: nextRow.poster.id, code: nextRow.poster.code } : null
        }
      />
    </div>
  );
}

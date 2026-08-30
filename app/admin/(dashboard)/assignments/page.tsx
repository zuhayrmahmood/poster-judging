import {
  AssignmentsPanel,
  type JudgeLoad,
} from "@/components/admin/assignments-panel";
import { autoAssign, loadPerJudge } from "@/lib/assign";
import { requireAdmin } from "@/lib/auth/admin";
import { getPosters, getPrimaryEvent } from "@/lib/data/admin";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AssignmentsPage() {
  await requireAdmin();

  const event = await getPrimaryEvent();
  if (!event) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
        Create an event in Settings first.
      </p>
    );
  }

  const [posters, activeJudges, existing] = await Promise.all([
    getPosters(event.id),
    query<{ id: string; name: string }>(
      "select id, name from judges where event_id = $1 and active order by name",
      [event.id],
    ),
    query<{ judge_id: string }>(
      "select judge_id from assignments where event_id = $1",
      [event.id],
    ),
  ]);

  // The preview is computed with the same pure function the commit action uses, and
  // autoAssign is deterministic — so what is shown here is exactly what gets saved.
  const plan = autoAssign(
    posters.map((p) => ({ id: p.id, code: p.code, location: p.location })),
    activeJudges.map((j) => j.id),
    event.target_judges_per_poster,
  );
  const proposed = loadPerJudge(plan);

  const current = new Map<string, number>();
  for (const row of existing) {
    current.set(row.judge_id, (current.get(row.judge_id) ?? 0) + 1);
  }

  const loads: JudgeLoad[] = activeJudges.map((judge) => ({
    judgeId: judge.id,
    name: judge.name,
    current: current.get(judge.id) ?? 0,
    proposed: proposed.get(judge.id) ?? 0,
  }));

  return (
    <AssignmentsPanel
      eventId={event.id}
      loads={loads}
      currentTotal={existing?.length ?? 0}
      proposedTotal={plan.length}
      target={event.target_judges_per_poster}
      posterCount={posters.length}
      judgeCount={activeJudges.length}
    />
  );
}

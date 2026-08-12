import { JudgesManager } from "@/components/admin/judges-manager";
import { requireAdmin } from "@/lib/auth/admin";
import { getJudgeProgress, getPrimaryEvent } from "@/lib/data/admin";

export const dynamic = "force-dynamic";

export default async function JudgesPage() {
  await requireAdmin();

  const event = await getPrimaryEvent();
  if (!event) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
        Create an event in Settings first.
      </p>
    );
  }

  const judges = await getJudgeProgress(event.id);
  return <JudgesManager eventId={event.id} judges={judges} />;
}

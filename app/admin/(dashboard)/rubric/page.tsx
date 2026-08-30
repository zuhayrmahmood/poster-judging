import { RubricManager } from "@/components/admin/rubric-manager";
import { requireAdmin } from "@/lib/auth/admin";
import { getCriteria, getPrimaryEvent } from "@/lib/data/admin";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function RubricPage() {
  await requireAdmin();

  const event = await getPrimaryEvent();
  if (!event) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
        Create an event in Settings first.
      </p>
    );
  }

  const [criteria, submitted] = await Promise.all([
    getCriteria(event.id),
    one<{ count: number }>(
      `select count(*)::int as count from submissions
        where event_id = $1 and status = 'submitted'`,
      [event.id],
    ),
  ]);

  const count = submitted?.count ?? 0;

  return (
    <RubricManager
      eventId={event.id}
      criteria={criteria}
      hasSubmissions={(count ?? 0) > 0}
    />
  );
}

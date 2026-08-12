import { RubricManager } from "@/components/admin/rubric-manager";
import { requireAdmin } from "@/lib/auth/admin";
import { getCriteria, getPrimaryEvent } from "@/lib/data/admin";
import { db } from "@/lib/supabase/admin";

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

  const [criteria, { count }] = await Promise.all([
    getCriteria(event.id),
    db()
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("event_id", event.id)
      .eq("status", "submitted"),
  ]);

  return (
    <RubricManager
      eventId={event.id}
      criteria={criteria}
      hasSubmissions={(count ?? 0) > 0}
    />
  );
}

import { RubricManager } from "@/components/admin/rubric-manager";
import { getCriteria } from "@/lib/data/admin";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function RubricPage({
  params,
}: PageProps<"/admin/events/[eventId]/rubric">) {
  const { eventId } = await params;

  const [criteria, submitted] = await Promise.all([
    getCriteria(eventId),
    one<{ count: number }>(
      `select count(*)::int as count from submissions
        where event_id = $1 and status = 'submitted'`,
      [eventId],
    ),
  ]);

  return (
    <RubricManager
      eventId={eventId}
      criteria={criteria}
      hasSubmissions={(submitted?.count ?? 0) > 0}
    />
  );
}

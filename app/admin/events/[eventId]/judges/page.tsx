import { JudgesManager } from "@/components/admin/judges-manager";
import { getJudgeProgress } from "@/lib/data/admin";

export const dynamic = "force-dynamic";

export default async function JudgesPage({
  params,
}: PageProps<"/admin/events/[eventId]/judges">) {
  const { eventId } = await params;
  const judges = await getJudgeProgress(eventId);
  return <JudgesManager eventId={eventId} judges={judges} />;
}

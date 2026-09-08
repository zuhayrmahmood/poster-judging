import { PostersManager } from "@/components/admin/posters-manager";
import { getPosters } from "@/lib/data/admin";

export const dynamic = "force-dynamic";

// The layout above proved membership for this event id, so reads below take it from
// the URL directly. See app/admin/events/[eventId]/layout.tsx.
export default async function PostersPage({
  params,
}: PageProps<"/admin/events/[eventId]/posters">) {
  const { eventId } = await params;
  const posters = await getPosters(eventId);
  return <PostersManager eventId={eventId} posters={posters} />;
}

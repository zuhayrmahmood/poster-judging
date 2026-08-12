import { PostersManager } from "@/components/admin/posters-manager";
import { requireAdmin } from "@/lib/auth/admin";
import { getPosters, getPrimaryEvent } from "@/lib/data/admin";

export const dynamic = "force-dynamic";

export default async function PostersPage() {
  await requireAdmin();

  const event = await getPrimaryEvent();
  if (!event) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
        Create an event in Settings first.
      </p>
    );
  }

  const posters = await getPosters(event.id);
  return <PostersManager eventId={event.id} posters={posters} />;
}

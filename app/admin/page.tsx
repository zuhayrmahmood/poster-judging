import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/admin";
import { listEvents } from "@/lib/services/events";

export const dynamic = "force-dynamic";

/**
 * The bare `/admin` entry point. Not a page in its own right — it decides where you
 * belong and sends you there.
 *
 * One event is the overwhelmingly common case, and making that organiser click through
 * a picker holding a single card would be silly. Anything else goes to the picker,
 * including zero events, where the picker doubles as the create form.
 */
export default async function AdminIndexPage() {
  const admin = await requireAdmin();
  const events = await listEvents(admin);

  if (events.length === 1) redirect(`/admin/events/${events[0].id}`);
  redirect("/admin/events");
}

import { notFound } from "next/navigation";

import { SettingsPanel } from "@/components/admin/settings-panel";
import { requireAdmin } from "@/lib/auth/admin";
import { getEventById } from "@/lib/data/admin";
import { listOrgs } from "@/lib/services/events";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  params,
}: PageProps<"/admin/events/[eventId]/settings">) {
  const { eventId } = await params;
  const admin = await requireAdmin();

  const event = await getEventById(eventId);
  if (!event) notFound();

  // Creating an event now lives on /admin/events; the panel keeps its org so the
  // create branch stays usable there without a second component.
  const [org] = await listOrgs(admin);

  return <SettingsPanel event={event} orgId={org?.id ?? null} />;
}

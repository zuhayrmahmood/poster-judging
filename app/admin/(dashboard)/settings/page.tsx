import { SettingsPanel } from "@/components/admin/settings-panel";
import { requireAdmin } from "@/lib/auth/admin";
import { getPrimaryEventForAdmin } from "@/lib/data/admin";
import { listOrgs } from "@/lib/services/events";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const admin = await requireAdmin();
  const event = await getPrimaryEventForAdmin(admin.id);

  // The panel needs an org to create an event *into*. Every admin has at least one
  // membership, so the first is a sound default until the org picker lands.
  const [org] = await listOrgs(admin);

  return <SettingsPanel event={event} orgId={org?.id ?? null} />;
}

import { SettingsPanel } from "@/components/admin/settings-panel";
import { requireAdmin } from "@/lib/auth/admin";
import { getPrimaryEvent } from "@/lib/data/admin";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdmin();
  const event = await getPrimaryEvent();
  return <SettingsPanel event={event} />;
}

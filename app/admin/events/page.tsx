import { EventPicker } from "@/components/admin/event-picker";
import { adminSignOut } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth/admin";
import { listEvents, listOrgs } from "@/lib/services/events";

export const dynamic = "force-dynamic";

/**
 * Every event the caller can reach, grouped by organisation.
 *
 * The list comes from LIST_EVENTS_FOR_ADMIN, which joins through `memberships` — so
 * this page cannot show an event the caller is not entitled to, and there is no
 * separate filter to forget.
 */
export default async function EventsPage() {
  const admin = await requireAdmin();
  const [events, orgs] = await Promise.all([listEvents(admin), listOrgs(admin)]);

  const byOrg = orgs.map((org) => ({
    org,
    events: events.filter((event) => event.org_id === org.id),
  }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Your events</h1>
          <p className="mt-0.5 text-sm text-muted">{admin.email}</p>
        </div>
        <form action={adminSignOut}>
          <button
            type="submit"
            className="rounded-lg px-2.5 py-2 text-xs font-medium text-muted hover:text-ink"
          >
            Sign out
          </button>
        </form>
      </div>

      {orgs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
          Your account is not part of an organisation yet, so there is nothing to create
          an event in. Ask whoever invited you to add you to theirs.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {byOrg.map(({ org, events: owned }) => (
            <EventPicker key={org.id} orgId={org.id} orgName={org.name} events={owned} />
          ))}
        </div>
      )}
    </main>
  );
}

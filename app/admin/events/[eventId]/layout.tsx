import Link from "next/link";
import { notFound } from "next/navigation";

import { adminSignOut } from "@/app/actions/admin";
import { requireEventScope } from "@/lib/auth/admin";
import { getEventById } from "@/lib/data/admin";

/**
 * Tabs for one event. The event id is in every href because there is no "current
 * event" anywhere — not in a cookie, not in the session. Ambient authority over which
 * event you are editing is exactly the property that made `getPrimaryEvent()` a
 * security bug, and two tabs open on two halls would fight over it.
 */
function tabsFor(eventId: string) {
  const base = `/admin/events/${eventId}`;
  return [
    { href: base, label: "Results" },
    { href: `${base}/posters`, label: "Posters" },
    { href: `${base}/judges`, label: "Judges" },
    { href: `${base}/rubric`, label: "Rubric" },
    { href: `${base}/assignments`, label: "Assignments" },
    { href: `${base}/settings`, label: "Settings" },
  ];
}

const STATUS_STYLE: Record<string, string> = {
  active: "bg-success-soft text-success",
  locked: "bg-surface-sunk text-muted",
  draft: "bg-warning-soft text-warning",
};

/**
 * Proves ownership once, for the whole subtree.
 *
 * Every page below this one takes the event id straight from the URL and queries with
 * it. That is only safe because this layout has already run `requireEventScope`, which
 * 404s an event the caller is not a member of — and 404, never 403, so the id space
 * cannot be used to discover that another organiser's event exists.
 */
export default async function EventLayout({
  children,
  params,
}: LayoutProps<"/admin/events/[eventId]">) {
  const { eventId } = await params;
  const { admin } = await requireEventScope(eventId);

  // requireEventScope proved membership; this is the row itself.
  const event = await getEventById(eventId);
  if (!event) notFound();

  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{event.name}</p>
            <p className="truncate text-xs text-muted">{admin.email}</p>
          </div>

          <Link
            href="/admin/events"
            className="shrink-0 rounded-lg px-2.5 py-2 text-xs font-medium text-muted hover:text-ink"
          >
            All events
          </Link>

          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              STATUS_STYLE[event.status] ?? "bg-surface-sunk text-muted"
            }`}
          >
            {event.status === "active"
              ? "Judging open"
              : event.status === "locked"
                ? "Judging closed"
                : "Draft"}
          </span>

          <form action={adminSignOut}>
            <button
              type="submit"
              className="rounded-lg px-2.5 py-2 text-xs font-medium text-muted hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>

        <nav className="mx-auto w-full max-w-6xl overflow-x-auto px-5">
          <ul className="flex gap-1 pb-px">
            {tabsFor(eventId).map((tab) => (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  className="block whitespace-nowrap rounded-t-lg px-3 py-2.5 text-sm
                             font-medium text-muted hover:bg-surface-sunk hover:text-ink"
                >
                  {tab.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-6">{children}</main>
    </>
  );
}

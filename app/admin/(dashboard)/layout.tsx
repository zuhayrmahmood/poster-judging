import Link from "next/link";

import { adminSignOut } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth/admin";
import { getPrimaryEvent } from "@/lib/data/admin";

const TABS = [
  { href: "/admin", label: "Results" },
  { href: "/admin/posters", label: "Posters" },
  { href: "/admin/judges", label: "Judges" },
  { href: "/admin/rubric", label: "Rubric" },
  { href: "/admin/assignments", label: "Assignments" },
  { href: "/admin/settings", label: "Settings" },
] as const;

const STATUS_STYLE: Record<string, string> = {
  active: "bg-success-soft text-success",
  locked: "bg-surface-sunk text-muted",
  draft: "bg-warning-soft text-warning",
};

// The `(dashboard)` route group is transparent in the URL, so this layout's route is
// `/admin` — it wraps every admin page except `/admin/login`, which sits outside it.
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireAdmin();
  const event = await getPrimaryEvent();

  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {event?.name ?? "No event yet"}
            </p>
            <p className="truncate text-xs text-muted">{admin.email}</p>
          </div>

          {event ? (
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
          ) : null}

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
            {TABS.map((tab) => (
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

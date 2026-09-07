import { redirect } from "next/navigation";
import Link from "next/link";

import { signOut } from "@/app/actions/judge";
import { PendingSyncBanner } from "@/components/pending-sync-banner";
import { getLiveJudgeSession } from "@/lib/data/judge";

export default async function JudgeLayout({ children }: LayoutProps<"/judge">) {
  // Signed out, or the judge was deleted or deactivated mid-event, or the event
  // vanished. Drop them back to sign-in rather than rendering a shell around nothing.
  // `/` applies the same predicate, so it will render the form rather than return them.
  const live = await getLiveJudgeSession();
  if (!live) redirect("/");

  const { judge, event } = live;

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-5 py-3">
          <Link href="/judge" className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{event.name}</p>
            <p className="truncate text-xs text-muted">{judge.name}</p>
          </Link>

          {event.status === "locked" ? (
            <span className="shrink-0 rounded-full bg-surface-sunk px-2.5 py-1 text-xs font-medium text-muted">
              Closed
            </span>
          ) : null}

          <form action={signOut}>
            <button
              type="submit"
              className="shrink-0 rounded-lg px-2.5 py-2 text-xs font-medium text-muted hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <PendingSyncBanner />

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pb-16 pt-5">{children}</main>
    </>
  );
}

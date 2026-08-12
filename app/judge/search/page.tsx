import Link from "next/link";
import { redirect } from "next/navigation";

import { getJudgeSession } from "@/lib/auth/judge-session";
import { searchPosters } from "@/lib/data/judge";

export const dynamic = "force-dynamic";

/**
 * Fallback for a judge who has wandered off their assigned aisle. Scoring an unassigned
 * poster is allowed — the assignment list is a suggested walking order, not a fence.
 */
export default async function SearchPage({
  searchParams,
}: PageProps<"/judge/search">) {
  const session = await getJudgeSession();
  if (!session) redirect("/");

  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const posters = await searchPosters(session.eventId, query);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/judge" className="text-sm text-muted hover:text-ink">
        ← My posters
      </Link>

      <h1 className="text-lg font-semibold tracking-tight">All posters</h1>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Poster code or title"
          autoComplete="off"
          enterKeyHint="search"
          className="min-h-12 w-full rounded-xl border border-line bg-surface px-4
                     text-base text-ink placeholder:text-muted/50
                     focus:border-accent focus:outline-none focus:ring-2
                     focus:ring-accent/30"
        />
        <button
          type="submit"
          className="min-h-12 shrink-0 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-ink"
        >
          Search
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {posters.map((poster) => (
          <li key={poster.id}>
            <Link
              href={`/judge/score/${poster.id}`}
              className="flex min-h-16 items-center gap-3 rounded-xl border border-line
                         bg-surface px-4 py-3 active:bg-surface-sunk"
            >
              <span className="w-14 shrink-0 font-mono text-sm font-semibold text-muted">
                {poster.code}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {poster.title}
                </span>
                {poster.presenter_names.length > 0 ? (
                  <span className="block truncate text-xs text-muted">
                    {poster.presenter_names.join(", ")}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {posters.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          {query ? `No posters match “${query}”.` : "No posters in this event yet."}
        </p>
      ) : null}
    </div>
  );
}

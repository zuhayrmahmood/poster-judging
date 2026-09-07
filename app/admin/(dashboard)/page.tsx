import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { requireAdmin } from "@/lib/auth/admin";
import {
  getJudgeProgress,
  getPrimaryEventForAdmin,
  getResults,
} from "@/lib/data/admin";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: PageProps<"/admin">) {
  const admin = await requireAdmin();

  const event = await getPrimaryEventForAdmin(admin.id);
  if (!event) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
        No event yet. Create one in Settings to get started.
      </p>
    );
  }

  const { mode } = await searchParams;
  const normalized = mode === "normalized";

  const [results, judges] = await Promise.all([
    getResults(event.id, normalized ? "normalized" : "raw"),
    getJudgeProgress(event.id),
  ]);

  const judged = results.filter((r) => r.n_judges > 0).length;
  const under = results.filter((r) => r.n_judges < event.target_judges_per_poster);
  const totalSubmitted = judges.reduce((sum, j) => sum + j.submitted, 0);
  const totalAssigned = judges.reduce((sum, j) => sum + j.assigned, 0);

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Posters judged" value={`${judged} / ${results.length}`} />
        <Stat label="Scores submitted" value={String(totalSubmitted)} />
        <Stat
          label="Assignments done"
          value={totalAssigned ? `${Math.round((totalSubmitted / totalAssigned) * 100)}%` : "—"}
        />
        <Stat
          label="Below target"
          value={String(under.length)}
          tone={under.length > 0 ? "warning" : "default"}
        />
      </section>

      {under.length > 0 ? (
        <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
          <strong className="font-semibold">{under.length}</strong>{" "}
          {under.length === 1 ? "poster has" : "posters have"} fewer than{" "}
          {event.target_judges_per_poster} judges:{" "}
          <span className="font-mono">
            {under.slice(0, 12).map((r) => r.code).join(", ")}
            {under.length > 12 ? `, +${under.length - 12} more` : ""}
          </span>
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Results</h1>

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-line p-0.5 text-sm">
              <Link
                href="/admin"
                className={`rounded-md px-3 py-1.5 font-medium ${
                  !normalized ? "bg-accent text-accent-ink" : "text-muted"
                }`}
              >
                Raw
              </Link>
              <Link
                href="/admin?mode=normalized"
                className={`rounded-md px-3 py-1.5 font-medium ${
                  normalized ? "bg-accent text-accent-ink" : "text-muted"
                }`}
              >
                Normalized
              </Link>
            </div>

            <a
              href="/admin/export/results"
              className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted hover:text-ink"
            >
              Export CSV
            </a>
          </div>
        </div>

        <p className="text-xs text-muted">
          {normalized ? (
            <>
              Ranked by each judge&apos;s score relative to their own average, which
              corrects for harsh and lenient judging. A judge with fewer than two
              submissions, or who scored everything identically, has no spread to
              measure and counts as neutral. Posters nobody has judged are unranked.
            </>
          ) : (
            <>
              Ranked by the weighted average across judges — the same number you would
              get on paper. Switch to Normalized to correct for harsh vs. lenient judges.
            </>
          )}
        </p>

        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-sunk text-left">
                <Th className="w-12">#</Th>
                <Th className="w-24">Poster</Th>
                <Th>Title</Th>
                <Th className="w-24 text-right">Raw</Th>
                <Th className="w-24 text-right">Norm</Th>
                <Th className="w-20 text-right">Judges</Th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => {
                const short = row.n_judges < event.target_judges_per_poster;
                return (
                  <tr key={row.poster_id} className="border-b border-line last:border-0">
                    <Td className="tabular-nums text-muted">
                      {row.raw_pct === null ? "—" : row.rank}
                    </Td>
                    <Td className="font-mono text-xs font-semibold">{row.code}</Td>
                    <Td>
                      <Link
                        href={`/admin/poster/${row.poster_id}`}
                        className="hover:underline"
                      >
                        {row.title}
                      </Link>
                    </Td>
                    <Td
                      className={`text-right tabular-nums ${!normalized ? "font-semibold" : "text-muted"}`}
                    >
                      {row.raw_pct === null ? "—" : `${Number(row.raw_pct).toFixed(2)}%`}
                    </Td>
                    <Td
                      className={`text-right tabular-nums ${normalized ? "font-semibold" : "text-muted"}`}
                    >
                      {row.norm_z === null ? "—" : formatZ(Number(row.norm_z))}
                    </Td>
                    <Td className="text-right tabular-nums">
                      <span className={short ? "text-warning" : ""}>
                        {row.n_judges}
                        {short ? " ⚠" : ""}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold tracking-tight">Judge progress</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {judges.map((judge) => {
            const pct = judge.assigned
              ? Math.round((judge.submitted / judge.assigned) * 100)
              : 0;
            return (
              <li
                key={judge.judge_id}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {judge.name}
                    {!judge.active ? (
                      <span className="ml-2 text-xs text-muted">(inactive)</span>
                    ) : null}
                  </span>
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-sunk">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                </span>
                <span className="shrink-0 text-sm tabular-nums text-muted">
                  {judge.submitted}/{judge.assigned}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/** Signed, so it reads as "above/below this judge's own average" at a glance. */
function formatZ(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(3)}`;
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${
          tone === "warning" ? "text-warning" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 text-xs font-medium text-muted ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 ${className}`}>{children}</td>;
}

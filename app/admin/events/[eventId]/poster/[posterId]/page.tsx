import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/admin";
import {
  getCriteria,
  getEventById,
  getOwnedPoster,
  getPosterSheets,
} from "@/lib/data/admin";

export const dynamic = "force-dynamic";

export default async function PosterDetailPage({
  params,
}: PageProps<"/admin/events/[eventId]/poster/[posterId]">) {
  const admin = await requireAdmin();
  const { eventId, posterId } = await params;

  // Scoped by admin, not by "the one global event": this page used to load any poster
  // by id and then trust `poster.event_id` for everything below it, which handed over
  // another organiser's per-judge scores and comments to anyone who could guess a UUID.
  const poster = await getOwnedPoster(posterId, admin.id);
  if (!poster) notFound();

  // The layout proved this event; getOwnedPoster proved this poster. This last check
  // ties the two together, so a poster cannot be viewed under a *different* event's URL
  // — same 404 as everything else, because the two cases must stay indistinguishable.
  if (poster.event_id !== eventId) notFound();

  const [event, criteria, sheets] = await Promise.all([
    getEventById(eventId),
    getCriteria(eventId),
    getPosterSheets(posterId, admin.id),
  ]);

  const scored = sheets.filter((s) => s.pct !== null);
  const average =
    scored.length > 0
      ? scored.reduce((sum, s) => sum + (s.pct ?? 0), 0) / scored.length
      : null;

  const short =
    event !== null && sheets.length < event.target_judges_per_poster;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href={`/admin/events/${eventId}`}
          className="text-sm text-muted hover:text-ink"
        >
          ← Results
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-surface-sunk px-2 py-0.5 font-mono text-xs font-semibold text-muted">
            {poster.code}
          </span>
          {poster.location ? (
            <span className="text-xs text-muted">Aisle {poster.location}</span>
          ) : null}
          {short ? (
            <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-medium text-warning">
              Below target coverage
            </span>
          ) : null}
        </div>

        <h1 className="text-xl font-semibold tracking-tight">{poster.title}</h1>
        {poster.presenter_names.length > 0 ? (
          <p className="text-sm text-muted">{poster.presenter_names.join(", ")}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          label="Weighted average"
          value={average === null ? "—" : `${average.toFixed(2)}%`}
        />
        <Stat label="Judges" value={String(sheets.length)} />
        <Stat
          label="Target"
          value={event ? String(event.target_judges_per_poster) : "—"}
        />
      </div>

      {sheets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
          No submitted scores for this poster yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-sunk text-left">
                <th className="px-3 py-2.5 text-xs font-medium text-muted">Judge</th>
                {criteria.map((criterion) => (
                  <th
                    key={criterion.id}
                    className="w-20 px-3 py-2.5 text-right text-xs font-medium text-muted"
                    title={`Weight ${criterion.weight}, out of ${criterion.max_score}`}
                  >
                    {criterion.label}
                  </th>
                ))}
                <th className="w-24 px-3 py-2.5 text-right text-xs font-medium text-muted">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {sheets.map((sheet) => (
                <tr key={sheet.judgeId} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5">{sheet.judgeName}</td>
                  {criteria.map((criterion) => (
                    <td
                      key={criterion.id}
                      className="px-3 py-2.5 text-right tabular-nums text-muted"
                    >
                      {sheet.scores[criterion.id] ?? "—"}
                      <span className="text-xs">/{criterion.max_score}</span>
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                    {sheet.pct === null ? "—" : `${sheet.pct.toFixed(2)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sheets.some((s) => s.comment) ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold tracking-tight">Comments</h2>
          <ul className="flex flex-col gap-2">
            {sheets
              .filter((sheet) => sheet.comment)
              .map((sheet) => (
                <li
                  key={sheet.judgeId}
                  className="rounded-xl border border-line bg-surface px-4 py-3"
                >
                  <p className="text-xs font-medium text-muted">{sheet.judgeName}</p>
                  <p className="mt-1 text-sm whitespace-pre-wrap">{sheet.comment}</p>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

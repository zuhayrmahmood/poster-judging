"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { subscribe, type OutboxItem } from "@/lib/outbox";
import type { AssignmentRow } from "@/lib/types";

type RowState = "not_started" | "draft" | "submitted" | "pending";

const BADGE: Record<RowState, { label: string; className: string }> = {
  submitted: { label: "Done", className: "bg-success-soft text-success" },
  pending: { label: "Pending sync", className: "bg-warning-soft text-warning" },
  draft: { label: "In progress", className: "bg-accent-soft text-accent" },
  not_started: { label: "To do", className: "bg-surface-sunk text-muted" },
};

export function AssignmentList({ rows }: { rows: AssignmentRow[] }) {
  const [queued, setQueued] = useState<Set<string>>(new Set());

  useEffect(
    () =>
      subscribe((items: OutboxItem[]) =>
        setQueued(new Set(items.map((item) => item.posterId))),
      ),
    [],
  );

  // A queued submission is the judge's most recent intent, so it wins over whatever
  // the server last told us about this poster.
  const stateOf = (row: AssignmentRow): RowState =>
    queued.has(row.poster.id) ? "pending" : row.status;

  const done = rows.filter((row) => {
    const state = stateOf(row);
    return state === "submitted" || state === "pending";
  }).length;

  const nextUp = rows.find((row) => stateOf(row) === "not_started");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">My posters</h1>
        <p className="text-sm tabular-nums text-muted">
          {done} of {rows.length} done
        </p>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-sunk"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={rows.length}
        aria-label="Posters scored"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: rows.length ? `${(done / rows.length) * 100}%` : "0%" }}
        />
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const state = stateOf(row);
          const badge = BADGE[state];
          const isNext = nextUp?.poster.id === row.poster.id;

          return (
            <li key={row.poster.id}>
              <Link
                href={`/judge/score/${row.poster.id}`}
                className={`flex min-h-16 items-center gap-3 rounded-xl border bg-surface
                            px-4 py-3 transition-colors active:bg-surface-sunk
                            ${isNext ? "border-accent" : "border-line"}`}
              >
                <span className="w-14 shrink-0 font-mono text-sm font-semibold text-muted">
                  {row.poster.code}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {row.poster.title}
                  </span>
                  {row.poster.presenter_names.length > 0 ? (
                    <span className="block truncate text-xs text-muted">
                      {row.poster.presenter_names.join(", ")}
                    </span>
                  ) : null}
                </span>

                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}
                >
                  {badge.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          You have no assigned posters yet. Check with an organiser, or search for a
          poster below.
        </p>
      ) : null}

      <Link
        href="/judge/search"
        className="mt-2 flex min-h-12 items-center justify-center rounded-xl
                   border border-line bg-surface text-sm font-medium text-muted
                   active:bg-surface-sunk"
      >
        Search all posters
      </Link>
    </div>
  );
}

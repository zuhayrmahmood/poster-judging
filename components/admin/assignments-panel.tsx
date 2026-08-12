"use client";

import { useState, useTransition } from "react";

import { clearAssignments, runAutoAssign } from "@/app/actions/admin";

export type JudgeLoad = { judgeId: string; name: string; current: number; proposed: number };

export function AssignmentsPanel({
  eventId,
  loads,
  currentTotal,
  proposedTotal,
  target,
  posterCount,
  judgeCount,
}: {
  eventId: string;
  loads: JudgeLoad[];
  currentTotal: number;
  proposedTotal: number;
  target: number;
  posterCount: number;
  judgeCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ready = posterCount > 0 && judgeCount > 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Assignments</h1>
        <p className="mt-1 text-sm text-muted">
          Posters are laid out in walking order and dealt to judges in contiguous
          blocks, so each judge gets a balanced load along one stretch of the hall.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-success-soft px-3 py-2.5 text-sm text-success">
          {notice}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Posters" value={String(posterCount)} />
        <Stat label="Active judges" value={String(judgeCount)} />
        <Stat label="Judges per poster" value={String(target)} />
        <Stat label="Current assignments" value={String(currentTotal)} />
      </div>

      {!ready ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
          Add at least one poster and one active judge before assigning.
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  Proposed plan: {proposedTotal} assignments
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  This replaces all current assignments. Scores judges have already
                  submitted are kept, even for posters that move off their list.
                </p>
              </div>
              <div className="flex gap-2">
                {currentTotal > 0 ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (confirm("Remove every assignment for this event?")) {
                        setError(null);
                        setNotice(null);
                        startTransition(() => clearAssignments(eventId));
                      }
                    }}
                    className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted hover:text-ink disabled:opacity-40"
                  >
                    Clear all
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    startTransition(async () => {
                      const result = await runAutoAssign(eventId);
                      if (result.error) setError(result.error);
                      else setNotice(`Saved ${result.count} assignments.`);
                    });
                  }}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-40"
                >
                  {pending
                    ? "Assigning…"
                    : currentTotal > 0
                      ? "Reassign everything"
                      : "Assign judges"}
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[28rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-sunk text-left">
                  <th className="px-3 py-2.5 text-xs font-medium text-muted">Judge</th>
                  <th className="w-28 px-3 py-2.5 text-right text-xs font-medium text-muted">
                    Now
                  </th>
                  <th className="w-28 px-3 py-2.5 text-right text-xs font-medium text-muted">
                    Proposed
                  </th>
                </tr>
              </thead>
              <tbody>
                {loads.map((load) => (
                  <tr key={load.judgeId} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5">{load.name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                      {load.current}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                      {load.proposed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
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

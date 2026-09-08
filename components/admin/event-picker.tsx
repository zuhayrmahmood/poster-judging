"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createEvent } from "@/app/actions/admin";
import type { Event } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  active: "Judging open",
  locked: "Judging closed",
  draft: "Draft",
};

const STATUS_STYLE: Record<string, string> = {
  active: "bg-success-soft text-success",
  locked: "bg-surface-sunk text-muted",
  draft: "bg-warning-soft text-warning",
};

/**
 * One organisation's events, plus the form that adds another.
 *
 * Creating lives here rather than in an event's own Settings tab, because you cannot
 * be inside an event you have not made yet — which is also why /admin sends an
 * organiser with no events straight to this page.
 */
export function EventPicker({
  orgId,
  orgName,
  events,
}: {
  orgId: string;
  orgName: string;
  events: Event[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const result = await createEvent(orgId, trimmed);
      if (result.error) {
        setError(result.error);
        return;
      }
      setName("");
      router.refresh();
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-tight text-muted">{orgName}</h2>

      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          No events yet. Everything else — posters, judges, the rubric — hangs off one.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((event) => (
            <li key={event.id}>
              <Link
                href={`/admin/events/${event.id}`}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface
                           px-4 py-3 hover:border-accent"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {event.name}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                    STATUS_STYLE[event.status] ?? "bg-surface-sunk text-muted"
                  }`}
                >
                  {STATUS_LABEL[event.status] ?? event.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="New event name"
          className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-4 text-sm
                     focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={pending || !name.trim()}
          className="min-h-11 rounded-xl bg-accent px-5 text-sm font-semibold
                     text-accent-ink disabled:opacity-40"
        >
          Create
        </button>
      </div>
    </section>
  );
}

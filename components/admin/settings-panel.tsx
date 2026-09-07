"use client";

import { useState, useTransition } from "react";

import {
  createEvent,
  renameEvent,
  setEventStatus,
  setTargetJudges,
} from "@/app/actions/admin";
import type { Event, EventStatus } from "@/lib/types";

const STATUS_COPY: Record<
  EventStatus,
  { title: string; body: string; action: string }
> = {
  draft: {
    title: "Draft",
    body: "Judges cannot sign in yet. Use this while you set up posters and the rubric.",
    action: "Open judging",
  },
  active: {
    title: "Judging open",
    body: "Judges can sign in, score, and revise their own scores.",
    action: "Close judging",
  },
  locked: {
    title: "Judging closed",
    body: "Judges can still see their scores but can no longer change them. Results are final.",
    action: "Reopen judging",
  },
};

export function SettingsPanel({
  event,
  orgId,
}: {
  event: Event | null;
  orgId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!event) {
    // Every organiser belongs to at least one organisation, so a missing orgId means
    // the account was created without a membership — which the invite flow prevents,
    // but a hand-inserted `admins` row does not.
    if (!orgId) {
      return (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
          Your account is not part of an organisation yet, so there is nothing to create
          an event in. Ask whoever invited you to add you to theirs.
        </p>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">Create your event</h1>
        <p className="text-sm text-muted">
          Everything else — posters, judges, the rubric — hangs off an event.
        </p>
        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <input
            aria-label="Event name"
            placeholder="2026 Research Expo"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-4 text-sm focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            disabled={pending || !newName.trim()}
            onClick={() =>
              startTransition(async () => {
                const result = await createEvent(orgId, newName);
                if (result.error) setError(result.error);
              })
            }
            className="min-h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-ink disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    );
  }

  const copy = STATUS_COPY[event.status];
  const nextStatus: EventStatus =
    event.status === "active" ? "locked" : "active";

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold tracking-tight">Settings</h1>

      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Section title="Event name">
        <NameField
          initial={event.name}
          pending={pending}
          onSave={(name) => {
            setError(null);
            startTransition(async () => {
              const result = await renameEvent(event.id, name);
              if (result.error) setError(result.error);
            });
          }}
        />
      </Section>

      <Section title="Judging status">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{copy.title}</p>
            <p className="mt-0.5 text-sm text-muted">{copy.body}</p>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const confirmMsg =
                nextStatus === "locked"
                  ? "Close judging? Judges will no longer be able to change their scores."
                  : null;
              if (confirmMsg && !confirm(confirmMsg)) return;
              setError(null);
              startTransition(async () => {
                const result = await setEventStatus(event.id, nextStatus);
                if (result.error) setError(result.error);
              });
            }}
            className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-40"
          >
            {copy.action}
          </button>
        </div>
      </Section>

      <Section title="Judges per poster">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Used by auto-assign, and to flag under-covered posters on the dashboard.
          </p>
          <TargetField
            initial={event.target_judges_per_poster}
            pending={pending}
            onSave={(value) => {
              setError(null);
              startTransition(async () => {
                const result = await setTargetJudges(event.id, value);
                if (result.error) setError(result.error);
              });
            }}
          />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function NameField({
  initial,
  pending,
  onSave,
}: {
  initial: string;
  pending: boolean;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex gap-2">
      <input
        aria-label="Event name"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="min-h-10 flex-1 rounded-lg border border-line bg-canvas px-3 text-sm focus:border-accent focus:outline-none"
      />
      {value.trim() && value !== initial ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => onSave(value)}
          className="rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40"
        >
          Save
        </button>
      ) : null}
    </div>
  );
}

function TargetField({
  initial,
  pending,
  onSave,
}: {
  initial: number;
  pending: boolean;
  onSave: (value: number) => void;
}) {
  const [value, setValue] = useState(String(initial));
  return (
    <div className="flex gap-2">
      <input
        aria-label="Judges per poster"
        type="number"
        min={1}
        max={20}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="min-h-10 w-20 rounded-lg border border-line bg-canvas px-3 text-sm focus:border-accent focus:outline-none"
      />
      {Number(value) !== initial && Number(value) >= 1 ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => onSave(Number(value))}
          className="rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40"
        >
          Save
        </button>
      ) : null}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";

import { createPoster, deletePoster, importPosters } from "@/app/actions/admin";
import type { Poster } from "@/lib/types";

export function PostersManager({
  eventId,
  posters,
}: {
  eventId: string;
  posters: Poster[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [csv, setCsv] = useState("");

  const [form, setForm] = useState({
    code: "",
    title: "",
    presenters: "",
    location: "",
  });

  const add = () => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await createPoster(eventId, form);
      if (result.error) setError(result.error);
      else setForm({ code: "", title: "", presenters: "", location: "" });
    });
  };

  const runImport = () => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await importPosters(eventId, csv);
      if (result.error) setError(result.error);
      else {
        setNotice(`Imported ${result.imported} posters.`);
        setCsv("");
        setShowImport(false);
      }
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">
          Posters <span className="font-normal text-muted">({posters.length})</span>
        </h1>
        <button
          type="button"
          onClick={() => setShowImport((v) => !v)}
          className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted hover:text-ink"
        >
          {showImport ? "Cancel import" : "Import CSV"}
        </button>
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

      {showImport ? (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
          <label htmlFor="csv" className="text-sm font-medium">
            Paste CSV
          </label>
          <p className="text-xs text-muted">
            Columns: <code className="font-mono">code,title,presenters,location</code>.
            Separate multiple presenters with a semicolon. A header row is optional.
          </p>
          <textarea
            id="csv"
            rows={6}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={"A-01,Nanofluidic sensors,Amara Osei;Ben Fletcher,A"}
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs
                       focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={runImport}
            disabled={pending || !csv.trim()}
            className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-semibold
                       text-accent-ink disabled:opacity-40"
          >
            {pending ? "Importing…" : "Import"}
          </button>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
        <p className="text-sm font-medium">Add a poster</p>
        <div className="grid gap-2 sm:grid-cols-[7rem_1fr_1fr_5rem_auto]">
          <Field placeholder="A-01" value={form.code} onChange={(v) => setForm({ ...form, code: v })} label="Code" />
          <Field placeholder="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} label="Title" />
          <Field placeholder="Names; separated" value={form.presenters} onChange={(v) => setForm({ ...form, presenters: v })} label="Presenters" />
          <Field placeholder="A" value={form.location} onChange={(v) => setForm({ ...form, location: v })} label="Aisle" />
          <button
            type="button"
            onClick={add}
            disabled={pending || !form.code.trim() || !form.title.trim()}
            className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-sunk text-left">
              <th className="w-24 px-3 py-2.5 text-xs font-medium text-muted">Code</th>
              <th className="px-3 py-2.5 text-xs font-medium text-muted">Title</th>
              <th className="px-3 py-2.5 text-xs font-medium text-muted">Presenters</th>
              <th className="w-16 px-3 py-2.5 text-xs font-medium text-muted">Aisle</th>
              <th className="w-16 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {posters.map((poster) => (
              <tr key={poster.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2.5 font-mono text-xs font-semibold">{poster.code}</td>
                <td className="px-3 py-2.5">{poster.title}</td>
                <td className="px-3 py-2.5 text-muted">
                  {poster.presenter_names.join(", ") || "—"}
                </td>
                <td className="px-3 py-2.5 text-muted">{poster.location ?? "—"}</td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        confirm(
                          `Delete ${poster.code}? Any scores already submitted for it are deleted too.`,
                        )
                      ) {
                        setError(null);
                        startTransition(async () => {
                          const result = await deletePoster(poster.id);
                          if (result.error) setError(result.error);
                        });
                      }
                    }}
                    className="rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-danger-soft"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {posters.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            No posters yet. Add one above or import a CSV.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm
                 focus:border-accent focus:outline-none"
    />
  );
}

"use client";

import { useState, useTransition } from "react";

import {
  createCriterion,
  deleteCriterion,
  updateCriterion,
} from "@/app/actions/admin";
import type { Criterion } from "@/lib/types";

export function RubricManager({
  eventId,
  criteria,
  hasSubmissions,
}: {
  eventId: string;
  criteria: Criterion[];
  hasSubmissions: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState({
    label: "",
    description: "",
    weight: "20",
    maxScore: "5",
  });

  const totalWeight = criteria.reduce((sum, c) => sum + Number(c.weight), 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Rubric</h1>
        <p className="mt-1 text-sm text-muted">
          Each criterion is scored out of its own maximum, then weighted. Weights are
          relative — they do not have to add up to 100.
        </p>
      </div>

      {hasSubmissions ? (
        <p className="rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning">
          Judges have already submitted scores. Changing weights or maximums re-scores
          every existing sheet; deleting a criterion discards the scores recorded
          against it.
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {criteria.map((criterion) => (
          <CriterionRow
            key={criterion.id}
            criterion={criterion}
            totalWeight={totalWeight}
            pending={pending}
            onSave={(input) =>
              startTransition(() => updateCriterion(criterion.id, input))
            }
            onDelete={() => {
              if (confirm(`Delete “${criterion.label}”?`)) {
                startTransition(() => deleteCriterion(criterion.id));
              }
            }}
          />
        ))}

        {criteria.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
            No criteria yet. Judges cannot submit until the rubric has at least one.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
        <p className="text-sm font-medium">Add a criterion</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1.5fr_5rem_5rem_auto]">
          <input
            aria-label="Label"
            placeholder="Research quality"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            className="min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm focus:border-accent focus:outline-none"
          />
          <input
            aria-label="Description"
            placeholder="Guidance shown to judges (optional)"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className="min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm focus:border-accent focus:outline-none"
          />
          <input
            aria-label="Weight"
            type="number"
            min={1}
            placeholder="Weight"
            value={draft.weight}
            onChange={(e) => setDraft({ ...draft, weight: e.target.value })}
            className="min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm focus:border-accent focus:outline-none"
          />
          <input
            aria-label="Max score"
            type="number"
            min={2}
            max={100}
            placeholder="Out of"
            value={draft.maxScore}
            onChange={(e) => setDraft({ ...draft, maxScore: e.target.value })}
            className="min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            disabled={pending || !draft.label.trim()}
            onClick={() =>
              startTransition(async () => {
                await createCriterion(eventId, {
                  label: draft.label,
                  description: draft.description,
                  weight: Number(draft.weight) || 1,
                  maxScore: Number(draft.maxScore) || 5,
                });
                setDraft({ label: "", description: "", weight: "20", maxScore: "5" });
              })
            }
            className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function CriterionRow({
  criterion,
  totalWeight,
  pending,
  onSave,
  onDelete,
}: {
  criterion: Criterion;
  totalWeight: number;
  pending: boolean;
  onSave: (input: {
    label: string;
    description: string;
    weight: number;
    maxScore: number;
  }) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(criterion.label);
  const [description, setDescription] = useState(criterion.description ?? "");
  const [weight, setWeight] = useState(String(criterion.weight));
  const [maxScore, setMaxScore] = useState(String(criterion.max_score));

  const dirty =
    label !== criterion.label ||
    description !== (criterion.description ?? "") ||
    Number(weight) !== Number(criterion.weight) ||
    Number(maxScore) !== criterion.max_score;

  const share = totalWeight > 0 ? (Number(criterion.weight) / totalWeight) * 100 : 0;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      <div className="grid gap-2 sm:grid-cols-[1fr_1.5fr_5rem_5rem]">
        <input
          aria-label="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm font-medium focus:border-accent focus:outline-none"
        />
        <input
          aria-label="Description"
          value={description}
          placeholder="No guidance shown"
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm focus:border-accent focus:outline-none"
        />
        <input
          aria-label="Weight"
          type="number"
          min={1}
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          className="min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm focus:border-accent focus:outline-none"
        />
        <input
          aria-label="Max score"
          type="number"
          min={2}
          max={100}
          value={maxScore}
          onChange={(e) => setMaxScore(e.target.value)}
          className="min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm focus:border-accent focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Scored 1–{criterion.max_score} · {share.toFixed(0)}% of the total
        </p>
        <div className="flex gap-1">
          {dirty ? (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                onSave({
                  label,
                  description,
                  weight: Number(weight) || 1,
                  maxScore: Number(maxScore) || 5,
                })
              }
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-40"
            >
              Save
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md px-2 py-1.5 text-xs font-medium text-danger hover:bg-danger-soft"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

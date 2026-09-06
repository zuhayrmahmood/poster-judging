"use client";

import { useState, useTransition } from "react";

import {
  createJudge,
  deleteJudge,
  regenerateAllCodes,
  regenerateJudgeCode,
  setJudgeActive,
} from "@/app/actions/admin";
import { formatCode } from "@/lib/auth/codes";
import type { JudgeProgress } from "@/lib/data/admin";

type Card = { name: string; code: string };

export function JudgesManager({
  eventId,
  judges,
}: {
  eventId: string;
  judges: JudgeProgress[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  // Plaintext codes exist only in this component's state — they are never stored, so
  // navigating away loses them for good.
  const [cards, setCards] = useState<Card[]>([]);

  const add = () => {
    setError(null);
    startTransition(async () => {
      const result = await createJudge(eventId, name, email);
      if (result.error || !result.code) {
        setError(result.error ?? "Couldn't add that judge.");
        return;
      }
      setCards((prev) => [...prev, { name: name.trim(), code: result.code! }]);
      setName("");
      setEmail("");
    });
  };

  const rotateOne = (judgeId: string, judgeName: string) => {
    setError(null);
    startTransition(async () => {
      const result = await regenerateJudgeCode(judgeId);
      if (result.error || !result.code) {
        setError(result.error ?? "Couldn't regenerate that code.");
        return;
      }
      setCards((prev) => [
        ...prev.filter((c) => c.name !== judgeName),
        { name: judgeName, code: result.code! },
      ]);
    });
  };

  const rotateAll = () => {
    if (
      !confirm(
        "Issue a new code to every active judge? Any code already handed out stops working.",
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await regenerateAllCodes(eventId);
      if (result.error) setError(result.error);
      else setCards(result.cards);
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">
          Judges <span className="font-normal text-muted">({judges.length})</span>
        </h1>
        <button
          type="button"
          onClick={rotateAll}
          disabled={pending}
          className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted hover:text-ink disabled:opacity-40"
        >
          New codes for all + print
        </button>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {cards.length > 0 ? <CodeCards cards={cards} onDismiss={() => setCards([])} /> : null}

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 print:hidden">
        <p className="text-sm font-medium">Add a judge</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            aria-label="Name"
            placeholder="Dr. Farrah Nazir"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm focus:border-accent focus:outline-none"
          />
          <input
            aria-label="Email"
            type="email"
            placeholder="Email (optional)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-10 rounded-lg border border-line bg-canvas px-3 text-sm focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={add}
            disabled={pending || !name.trim()}
            className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40"
          >
            Add &amp; get code
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line print:hidden">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-sunk text-left">
              <th className="px-3 py-2.5 text-xs font-medium text-muted">Judge</th>
              <th className="w-24 px-3 py-2.5 text-xs font-medium text-muted">Code</th>
              <th className="w-32 px-3 py-2.5 text-xs font-medium text-muted">Progress</th>
              <th className="w-52 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {judges.map((judge) => (
              <tr key={judge.judge_id} className="border-b border-line last:border-0">
                <td className="px-3 py-2.5">
                  {judge.name}
                  {!judge.active ? (
                    <span className="ml-2 rounded-full bg-surface-sunk px-2 py-0.5 text-xs text-muted">
                      inactive
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-muted">
                  ····{judge.code_hint}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-muted">
                  {judge.submitted}/{judge.assigned}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => rotateOne(judge.judge_id, judge.name)}
                      disabled={pending}
                      className="rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface-sunk hover:text-ink"
                    >
                      New code
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        startTransition(async () => {
                          const result = await setJudgeActive(
                            judge.judge_id,
                            !judge.active,
                          );
                          if (result.error) setError(result.error);
                        });
                      }}
                      disabled={pending}
                      className="rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface-sunk hover:text-ink"
                    >
                      {judge.active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          confirm(
                            `Delete ${judge.name}? Their submitted scores are deleted too.`,
                          )
                        ) {
                          setError(null);
                          startTransition(async () => {
                            const result = await deleteJudge(judge.judge_id);
                            if (result.error) setError(result.error);
                          });
                        }
                      }}
                      className="rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-danger-soft"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {judges.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">No judges yet.</p>
        ) : null}
      </div>
    </div>
  );
}

/** Printable cards. Only rendered for codes generated in this browser session. */
function CodeCards({ cards, onDismiss }: { cards: Card[]; onDismiss: () => void }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border-2 border-accent bg-accent-soft p-4 print:border-0 print:bg-transparent print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm font-semibold text-accent">
          {cards.length === 1 ? "New access code" : `${cards.length} new access codes`} —
          shown once
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink"
          >
            Print
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg border border-accent/40 px-3 py-1.5 text-xs font-medium text-accent"
          >
            Done
          </button>
        </div>
      </div>

      <p className="text-xs text-accent print:hidden">
        These are stored only as hashes and cannot be shown again. Print or write them
        down before leaving this page.
      </p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.name}
            className="rounded-lg border border-line bg-surface px-4 py-3 print:break-inside-avoid"
          >
            <p className="text-xs text-muted">{card.name}</p>
            <p className="mt-1 font-mono text-xl font-bold tracking-[0.15em]">
              {formatCode(card.code)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

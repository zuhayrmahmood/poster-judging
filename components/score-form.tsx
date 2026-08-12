"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { saveDraft, submitScore } from "@/app/actions/judge";
import { clearDraft, enqueue, readDraft, writeDraft } from "@/lib/outbox";
import { roundTo, weightedPct } from "@/lib/scoring";
import type { Criterion, Poster } from "@/lib/types";

const SERVER_DRAFT_DEBOUNCE_MS = 400;

type Props = {
  judgeId: string;
  poster: Poster;
  criteria: Criterion[];
  initialScores: Record<string, number>;
  initialComment: string;
  /** Epoch ms of the server's copy, for resolving against a local draft. */
  serverUpdatedAt: number | null;
  alreadySubmitted: boolean;
  locked: boolean;
  nextPoster: { id: string; code: string } | null;
};

export function ScoreForm({
  judgeId,
  poster,
  criteria,
  initialScores,
  initialComment,
  serverUpdatedAt,
  alreadySubmitted,
  locked,
  nextPoster,
}: Props) {
  const router = useRouter();
  const [scores, setScores] = useState(initialScores);
  const [comment, setComment] = useState(initialComment);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rehydrate from the local draft when it is newer than what the server sent. This is
  // what recovers a sheet the judge filled in with no signal and then backgrounded.
  //
  // This has to be an effect rather than a lazy `useState` initializer: localStorage
  // does not exist during SSR, so seeding state from it during render would make the
  // server HTML and the first client render disagree. Reading it after mount is the
  // supported way to sync from a client-only external store, and it runs exactly once.
  //
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (locked) return;
    const draft = readDraft(judgeId, poster.id);
    if (draft && (!serverUpdatedAt || draft.updatedAt > serverUpdatedAt)) {
      setScores(draft.scores);
      setComment(draft.comment);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  /** Local write is synchronous and always happens; the server copy is best-effort. */
  const persist = useCallback(
    (nextScores: Record<string, number>, nextComment: string) => {
      writeDraft(judgeId, poster.id, { scores: nextScores, comment: nextComment });

      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => {
        // A failed draft save is not worth telling the judge about — the local copy is
        // authoritative until they submit, and submit has its own retry path.
        void saveDraft(poster.id, nextScores, nextComment).catch(() => {});
      }, SERVER_DRAFT_DEBOUNCE_MS);
    },
    [judgeId, poster.id],
  );

  useEffect(
    () => () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    },
    [],
  );

  const setScore = (criterionId: string, value: number) => {
    const next = { ...scores, [criterionId]: value };
    setScores(next);
    persist(next, comment);
  };

  const onComment = (value: string) => {
    setComment(value);
    persist(scores, value);
  };

  const answered = criteria.filter((c) => scores[c.id] !== undefined).length;
  const complete = answered === criteria.length && criteria.length > 0;
  const total = weightedPct(scores, criteria);

  const goNext = () => {
    clearDraft(judgeId, poster.id);
    router.push(nextPoster ? `/judge/score/${nextPoster.id}` : "/judge");
    router.refresh();
  };

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitScore(poster.id, scores, comment);
      if (result.ok) {
        goNext();
      } else {
        // The server understood us and said no (event locked, wrong event). Queuing
        // this would retry something that can never succeed.
        setError(result.error);
        setSubmitting(false);
      }
    } catch {
      // Network failure. Keep the judge moving; the banner in the layout shows the
      // queue and retries it as soon as there is signal.
      enqueue({
        judgeId,
        posterId: poster.id,
        posterCode: poster.code,
        scores,
        comment,
      });
      goNext();
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-surface-sunk px-2 py-0.5 font-mono text-xs font-semibold text-muted">
            {poster.code}
          </span>
          {poster.location ? (
            <span className="text-xs text-muted">Aisle {poster.location}</span>
          ) : null}
          {alreadySubmitted ? (
            <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
              Submitted
            </span>
          ) : null}
        </div>
        <h1 className="text-lg font-semibold leading-snug tracking-tight">
          {poster.title}
        </h1>
        {poster.presenter_names.length > 0 ? (
          <p className="text-sm text-muted">{poster.presenter_names.join(", ")}</p>
        ) : null}
      </header>

      {locked ? (
        <p className="rounded-lg bg-surface-sunk px-3 py-2.5 text-sm text-muted">
          Judging is closed. Your scores are shown below but can no longer be changed.
        </p>
      ) : null}

      <ol className="flex flex-col gap-5">
        {criteria.map((criterion) => (
          <li key={criterion.id} className="flex flex-col gap-2.5">
            <div>
              <p className="text-sm font-medium">{criterion.label}</p>
              {criterion.description ? (
                <p className="mt-0.5 text-xs text-muted">{criterion.description}</p>
              ) : null}
            </div>

            <div
              role="radiogroup"
              aria-label={criterion.label}
              className="no-select grid gap-1.5"
              style={{
                gridTemplateColumns: `repeat(${criterion.max_score}, minmax(0, 1fr))`,
              }}
            >
              {Array.from({ length: criterion.max_score }, (_, i) => i + 1).map(
                (value) => {
                  const selected = scores[criterion.id] === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={locked}
                      onClick={() => setScore(criterion.id, value)}
                      // min-h-12 keeps every target at least 48px tall; the grid keeps
                      // them wide. Both matter one-handed while holding a bag.
                      className={`min-h-12 rounded-lg border text-base font-semibold
                                  transition-colors disabled:opacity-60
                        ${
                          selected
                            ? "border-accent bg-accent text-accent-ink"
                            : "border-line bg-surface text-muted active:bg-surface-sunk"
                        }`}
                    >
                      {value}
                    </button>
                  );
                },
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2">
        <label htmlFor="comment" className="text-sm font-medium">
          Comments <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="comment"
          value={comment}
          disabled={locked}
          onChange={(event) => onComment(event.target.value)}
          rows={3}
          placeholder="Anything the organisers should know…"
          className="w-full rounded-xl border border-line bg-surface px-3.5 py-3
                     text-base text-ink placeholder:text-muted/50
                     focus:border-accent focus:outline-none focus:ring-2
                     focus:ring-accent/30 disabled:opacity-60"
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {!locked ? (
        <div className="sticky bottom-0 -mx-5 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="text-muted">
              {complete
                ? "All criteria scored"
                : `${criteria.length - answered} left`}
            </span>
            <span className="font-mono font-semibold tabular-nums">
              {total === null ? "—" : `${roundTo(total, 1)}%`}
            </span>
          </div>

          <button
            type="button"
            onClick={onSubmit}
            disabled={!complete || submitting}
            className="min-h-14 w-full rounded-xl bg-accent text-base font-semibold
                       text-accent-ink transition-opacity disabled:opacity-40"
          >
            {submitting
              ? "Saving…"
              : alreadySubmitted
                ? "Update score"
                : nextPoster
                  ? `Submit and go to ${nextPoster.code}`
                  : "Submit"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

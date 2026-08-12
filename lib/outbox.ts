/**
 * Client-side durability for the scoring form.
 *
 * Two separate concerns share this module:
 *
 * - **Drafts** — the in-progress sheet, written on every tap. Survives a backgrounded
 *   tab, an accidental back-swipe, or a phone that runs out of battery mid-aisle.
 * - **Outbox** — submissions that failed to reach the server. They are retried when
 *   connectivity returns, so a judge never has to remember which poster didn't save.
 *
 * Replaying an outbox item is safe: `save_submission` upserts on (judge, poster) and
 * replaces the child score rows wholesale, so a duplicate delivery overwrites rather
 * than double-counting.
 *
 * Every localStorage call is guarded — Safari throws on write in private mode, and a
 * judge with a full disk should still be able to submit online.
 */

export type Draft = {
  scores: Record<string, number>;
  comment: string;
  updatedAt: number;
};

export type OutboxItem = {
  id: string;
  judgeId: string;
  posterId: string;
  posterCode: string;
  scores: Record<string, number>;
  comment: string;
  queuedAt: number;
};

const OUTBOX_KEY = "pj:outbox";
const draftKey = (judgeId: string, posterId: string) =>
  `pj:draft:${judgeId}:${posterId}`;

const canUseStorage = () => typeof window !== "undefined" && !!window.localStorage;

function read<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled. The submit path still works online.
  }
}

function remove(key: string): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export function readDraft(judgeId: string, posterId: string): Draft | null {
  return read<Draft | null>(draftKey(judgeId, posterId), null);
}

export function writeDraft(
  judgeId: string,
  posterId: string,
  draft: Omit<Draft, "updatedAt">,
): void {
  write(draftKey(judgeId, posterId), { ...draft, updatedAt: Date.now() });
}

export function clearDraft(judgeId: string, posterId: string): void {
  remove(draftKey(judgeId, posterId));
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

type Listener = (items: OutboxItem[]) => void;
const listeners = new Set<Listener>();

export function readOutbox(): OutboxItem[] {
  return read<OutboxItem[]>(OUTBOX_KEY, []);
}

function writeOutbox(items: OutboxItem[]): void {
  write(OUTBOX_KEY, items);
  for (const listener of listeners) listener(items);
}

export function enqueue(item: Omit<OutboxItem, "id" | "queuedAt">): void {
  const items = readOutbox();
  // One entry per poster: a later attempt supersedes an earlier queued one, so a judge
  // who edits twice offline uploads their final answer, not both versions in sequence.
  const next = items.filter((existing) => existing.posterId !== item.posterId);
  next.push({ ...item, id: crypto.randomUUID(), queuedAt: Date.now() });
  writeOutbox(next);
}

export function dequeue(id: string): void {
  writeOutbox(readOutbox().filter((item) => item.id !== id));
}

/** Subscribe to pending-count changes. Returns an unsubscribe function. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(readOutbox());
  return () => listeners.delete(listener);
}

export type SubmitFn = (
  posterId: string,
  scores: Record<string, number>,
  comment: string,
) => Promise<{ ok: true } | { ok: false; error: string }>;

let flushing = false;

/**
 * Attempts every queued item once.
 *
 * A *rejected* item (event locked, poster not in event) is dropped rather than retried
 * forever — it will never succeed, and leaving it in the queue would show a permanent
 * "pending sync" badge that the judge cannot clear. A *network* failure keeps its place.
 */
export async function flushOutbox(submit: SubmitFn): Promise<void> {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    for (const item of readOutbox()) {
      try {
        const result = await submit(item.posterId, item.scores, item.comment);
        if (result.ok) {
          dequeue(item.id);
          clearDraft(item.judgeId, item.posterId);
        } else {
          dequeue(item.id);
        }
      } catch {
        // Still offline or the server is unreachable; keep it queued and stop early
        // rather than hammering through the whole list.
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

const RETRY_INTERVAL_MS = 20_000;

/** Starts the background retry loop. Returns a teardown function. */
export function startFlusher(submit: SubmitFn): () => void {
  const run = () => void flushOutbox(submit);

  run();
  const timer = setInterval(run, RETRY_INTERVAL_MS);
  window.addEventListener("online", run);

  return () => {
    clearInterval(timer);
    window.removeEventListener("online", run);
  };
}

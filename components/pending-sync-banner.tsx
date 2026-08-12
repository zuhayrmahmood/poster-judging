"use client";

import { useEffect, useState } from "react";

import { submitScore } from "@/app/actions/judge";
import { startFlusher, subscribe, type OutboxItem } from "@/lib/outbox";

/**
 * Shows what has not reached the server yet, and owns the retry loop for the whole
 * judge section — it is mounted once in the layout, so retries keep running while the
 * judge browses their list rather than only while a form is open.
 */
export function PendingSyncBanner() {
  const [pending, setPending] = useState<OutboxItem[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribe(setPending);
    const stopFlusher = startFlusher(submitScore);

    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    return () => {
      unsubscribe();
      stopFlusher();
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (pending.length === 0 && online) return null;

  return (
    <div
      role="status"
      className="border-b border-warning/25 bg-warning-soft px-5 py-2.5 text-center"
    >
      <p className="mx-auto max-w-2xl text-xs font-medium text-warning">
        {pending.length > 0 ? (
          <>
            {pending.length} {pending.length === 1 ? "score" : "scores"} saved on this
            phone, waiting to upload
            {online ? "…" : " — you're offline"}
          </>
        ) : (
          <>You&apos;re offline. Scores will save here and upload automatically.</>
        )}
      </p>
    </div>
  );
}

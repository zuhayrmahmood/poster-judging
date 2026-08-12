"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Polls the server for fresh dashboard data.
 *
 * Polling rather than Supabase Realtime because every table is RLS deny-all, so the
 * browser cannot subscribe — all reads go through server code holding the service-role
 * key. At 15s this is well inside free-tier limits and is plenty for a live event.
 *
 * Pauses while the tab is hidden so a dashboard left open overnight doesn't poll
 * thousands of times for nothing.
 */
export function AutoRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const onVisibility = () => {
      const hidden = document.visibilityState === "hidden";
      setPaused(hidden);
      // Catch up immediately on return rather than waiting out the interval.
      if (!hidden) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [router]);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [paused, intervalMs, router]);

  return null;
}

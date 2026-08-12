"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

export function AdminLoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const { error: signInError } = await createClient().auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError("Incorrect email or password.");
      setPending(false);
      return;
    }

    // Full refresh so the new auth cookies reach the server on the next render.
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-muted">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-h-12 rounded-xl border border-line bg-surface px-4 text-base
                     focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-muted">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="min-h-12 rounded-xl border border-line bg-surface px-4 text-base
                     focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-12 rounded-xl bg-accent text-sm font-semibold text-accent-ink
                   transition-opacity disabled:opacity-40"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

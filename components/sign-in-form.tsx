"use client";

import { useActionState, useState } from "react";

import { signIn, type SignInResult } from "@/app/actions/judge";

/** `K7M2Q9XR` typed one character at a time becomes `K7M2-Q9XR` as they go. */
function formatAsTyped(raw: string): string {
  const stripped = raw.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 8);
  return stripped.length > 4
    ? `${stripped.slice(0, 4)}-${stripped.slice(4)}`
    : stripped;
}

export function SignInForm() {
  const [state, action, pending] = useActionState<SignInResult | null, FormData>(
    signIn,
    null,
  );
  const [code, setCode] = useState("");

  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="code" className="text-sm font-medium text-muted">
          Judge access code
        </label>
        <input
          id="code"
          name="code"
          value={code}
          onChange={(event) => setCode(formatAsTyped(event.target.value))}
          // Codes are uppercase and never words: turn off every helpful-but-wrong
          // mobile keyboard behaviour at once.
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          enterKeyHint="go"
          placeholder="K7M2-Q9XR"
          aria-describedby={state?.error ? "code-error" : undefined}
          aria-invalid={state?.error ? true : undefined}
          className="w-full rounded-xl border border-line bg-surface px-4 py-4
                     text-center font-mono text-2xl tracking-[0.2em] text-ink
                     placeholder:text-muted/40 placeholder:tracking-[0.2em]
                     focus:border-accent focus:outline-none focus:ring-2
                     focus:ring-accent/30"
        />
      </div>

      {state?.error ? (
        <p
          id="code-error"
          role="alert"
          className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || code.replace("-", "").length < 8}
        className="min-h-14 rounded-xl bg-accent px-4 text-base font-semibold
                   text-accent-ink transition-opacity disabled:opacity-40"
      >
        {pending ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

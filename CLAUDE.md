@AGENTS.md

# Poster judging — orientation

Judges score posters from their phones; organisers watch results aggregate live.
README.md covers setup, running an event, the results math, and the security model —
read it rather than re-deriving any of that. KNOWN-ISSUES.md tracks unfixed defects;
check it before reporting a bug as new. This file is the parts that are easy to get wrong.

## Shape of the app

There is **no HTTP API**. The backend is three things fused into the Next.js process:

- `app/actions/*.ts` — 22 Server Actions (18 admin, 4 judge). Client components import
  them as functions, not URLs.
- `lib/data/*.ts` — reads called directly from server components (~24 `db()` sites).
- Postgres — the real logic. Aggregation lives in `supabase/migrations/0002_views.sql`,
  atomic writes + authorization in `save_submission` (`0003`). Prefer changing SQL over
  reimplementing it in TypeScript.

`proxy.ts` is Next 16's rename of `middleware.ts`. It is a **first-pass redirect, not the
security boundary** — Server Actions are reachable by direct POST, so every action
re-checks the session itself (`requireAdmin()` / `getJudgeSession()`).

## Invariants — do not break these

- **`lib/scoring.ts` mirrors `0002_views.sql`.** Change one, change the other.
  `tests/scoring.test.ts` pins both to the same fixture; that is the only thing stopping a
  silent divergence between the judge preview and the dashboard.
- **`save_submission` upserts on `(judge, poster)`** and replaces child score rows
  wholesale. The offline outbox in `lib/outbox.ts` depends on that idempotency — a replayed
  submission must overwrite, never double-count.
- **The service-role key must never reach the client.** `lib/supabase/admin.ts` imports
  `server-only` so a bad import is a build error, not a leak. Keep it that way.
- **Every table is RLS deny-all with privileges revoked.** All access goes through server
  code holding the service-role key *after* it has checked authorization. Consequence: the
  browser cannot use Realtime, so the dashboard polls (`components/auto-refresh.tsx`).

## Conventions

- Migrations are applied **by hand** in the Supabase SQL editor — there is no migration
  runner. Schema changes need a new numbered file in `supabase/migrations/`.
- `lib/types.ts` is hand-written, not generated, so it can drift from the schema. Check it
  against the migrations when touching either.
- `npm test` — node's test runner via tsx, over the pure modules (`scoring`, `assign`,
  `codes`). Those three are dependency-free on purpose; keep them that way.
- Judges may score **any poster in their own event**, not only assigned ones. Assignments
  are a suggested walking order. Crossing events is what's forbidden.

## Decisions already made

- **Backend stays in TypeScript.** A Java/Spring port was evaluated on 2026-08-13 and
  judged not worth it: the valuable logic is already in SQL, load is trivial, and a port
  mainly means inventing the API seam that doesn't currently exist. If it is ever revisited,
  two traps: `lib/assign.ts` sorts codes with `localeCompare(…, {numeric: true})` (Java's
  `Collator` is not numeric-aware), and Postgres `round()` is half-away-from-zero vs Java's
  half-up, which disagrees on negative `norm_z`.
- **Auto-assign deals contiguous blocks** of the walking order. An earlier aisle-affinity
  heuristic measured as a no-op at usable settings and wrecked load balance beyond them —
  don't reintroduce it.

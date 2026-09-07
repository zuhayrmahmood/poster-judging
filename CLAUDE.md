@AGENTS.md

# Poster judging — orientation

Judges score posters from their phones; organisers watch results aggregate live.
README.md covers setup, running an event, the results math, and the security model —
read it rather than re-deriving any of that. KNOWN-ISSUES.md tracks unfixed defects;
check it before reporting a bug as new. This file is only the parts that are easy to
get wrong.

## Shape of the app

The backend has **two transports over one service layer**:

- `app/api/**/route.ts` — 28 REST Route Handlers. Same-origin only, cookie-authenticated,
  documented in `openapi.json` and served at `/api/openapi.json`.
- `app/actions/*.ts` — 22 Server Actions (18 admin, 4 judge). Client components import
  them as functions, not URLs. Both transports are **thin adapters**: resolve the caller,
  call a service, map the result. No authorization logic lives in either.
- `lib/services/*.ts` — where authorization, validation and SQL actually live. Each
  function takes an explicit actor and returns `ServiceResult`, and never touches
  cookies, `redirect()` or `revalidatePath()`. That split is what lets a second
  transport (a Route Handler) share one ownership check instead of inventing a second.
- `lib/sql/scoped.ts` — the tenant-scoped SQL as exported strings. A **pure module** on
  purpose: `tests/tenancy.test.ts` runs these exact strings against PGlite, and a test
  against a re-typed copy would prove nothing.
- `lib/data/*.ts` — reads called directly from server components, hand-written SQL.
  The `eventId`-taking ones assume the caller already ran `requireEventScope`; the ones
  taking a bare child id (`getOwnedPoster`, `getPosterSheets`) scope themselves.
- Postgres — the real logic. Aggregation lives in `supabase/migrations/0002_views.sql`,
  atomic writes + authorization in `save_submission` (`0003`). Prefer changing SQL over
  reimplementing it in TypeScript.

Client components never fetch. They take server-rendered props and call actions; the
REST API exists for scripted and external use, not for the app's own UI. The one
exception is `admin-login-form.tsx`, which talks to Supabase auth directly.

**Route Handlers get no CSRF protection.** Next validates `Origin` for Server Action
invocations but not for Route Handlers, so every mutating handler calls
`requireSameOrigin()` from `lib/http/guards.ts`. `tests/api-contract.test.ts` fails if one
forgets. Handlers must also never call `requireAdmin()`/`requireEventScope()` — those
throw navigation signals meant for rendering, and surface as an opaque 500 on an API
route; use `resolveAdmin()`/`resolveJudge()`, which return null.

`proxy.ts` is Next 16's rename of `middleware.ts`. It is a **first-pass redirect, not the
security boundary** — Server Actions and Route Handlers are reachable by direct POST/GET,
so every one of them re-checks the session itself.

## Two unrelated auth systems

- **Admins** — Supabase Auth *plus* a row in `admins`; the row is the actual grant.
  `getAdmin()` uses `auth.getUser()` (revalidates) and never `getSession()`.
  Every admin action calls `requireAdmin()`.
- **Judges** — an 8-char access code exchanged for an HS256 JWT (`jose`) in the
  `pj_judge` cookie, 24h. Every judge action calls `getJudgeSession()`.

Three things here look like bugs and are not:

- `lib/auth/judge-session.ts` must stay free of `node:crypto` because `proxy.ts` imports
  it on the edge; hashing lives in `lib/auth/codes.ts`, which is not edge-safe. That
  runtime split is the only reason they are separate files.
- The judge cookie is `secure: false` — the app runs over plain HTTP on a venue LAN.
- Login throttling keys on the **hash of the attempted code**, never the IP (a hall of
  judges shares one), and fails open on a DB error.

## Invariants — do not break these

- **`lib/scoring.ts` mirrors `0002_views.sql`.** Change one, change the other.
  `tests/scoring.test.ts` pins both to the same fixture; that is the only thing stopping
  a silent divergence between the judge preview and the dashboard.
- **`save_submission` upserts on `(judge, poster)`** and replaces child score rows
  wholesale. The offline outbox in `lib/outbox.ts` depends on that idempotency — a
  replayed submission must overwrite, never double-count.
- **`null` and `0` mean different things.** An unjudged poster has `raw_pct`/`norm_z`
  null and is *unranked*; `norm_z = 0` is a judge with no measurable spread counting as
  neutral. Never collapse one into the other.
- **`DATABASE_URL` must never reach the client.** `lib/db/index.ts` imports `server-only`
  so a bad import is a build error, not a leak. Keep it that way; scripts import
  `lib/db/client` instead.
- **Every table is RLS deny-all with privileges revoked.** All access goes through server
  code on a direct Postgres connection *after* it has checked authorization. Consequence:
  the browser cannot use Realtime, so the dashboard polls (`components/auto-refresh.tsx`).
- **Judges may score any poster in their own event**, not only assigned ones.
  Assignments are a suggested walking order. Crossing events is what's forbidden.
- **`/` and `/judge` must share one answer to "is this judge signed in".** Both call
  `getLiveJudgeSession()` (`lib/data/judge.ts`), which checks the database, not just the
  cookie. The judge cookie is a self-contained 24h JWT that keeps verifying after an
  organiser deletes or deactivates that judge, so a page gating its redirect on the raw
  token disagrees with the other one and the two bounce the judge between them forever —
  the phone renders neither the app nor the sign-in form that would let them recover.
  `tests/judge-session.test.ts` fails if either page goes back to deciding for itself.

- **In `score-form.tsx`, a network failure and a rejection are handled differently on
  purpose**: a thrown submit goes to the outbox and the judge moves on; a well-formed
  `ok: false` (judging closed) surfaces inline and is never queued. Don't unify them.

## Conventions

- Migrations run via `npm run migrate`. Schema changes need a new numbered file in
  `supabase/migrations/`. Keep Supabase-specific DDL (anything touching `auth.users` or
  the anon/authenticated roles) in `0004` — `tests/schema.test.ts` runs the others
  against in-memory Postgres, and that only works while the split holds.
- `lib/types.ts` is hand-written, not generated, so it can drift from the schema. Check
  it against the migrations when touching either. Postgres sends `numeric` and `count()`
  as strings; coerce with `num`/`numOr` from `lib/db`.
- Never name a prepared statement — transaction-mode pooling will not find it again.
  `lib/db/client.ts` is the only connection seam.
- `npm test` — node's test runner via tsx, over the pure modules (`scoring`, `assign`,
  `codes`) plus the SQL views. Those three modules are dependency-free on purpose; keep
  them that way.
- Tailwind 4 with no config file; theme tokens live in `app/globals.css`. The judge UI is
  phone-first — the tap-target sizes and `touch-action` rules in `ScoreForm` and
  `globals.css` are load-bearing, not cosmetic.

## Decisions already made

- **The database is hosted Supabase Postgres, reached over a connection string** — not
  PostgREST, and not embedded. Use the transaction pooler (6543) for the app and the
  direct connection (5432) for `npm run migrate`.
- **Backend stays in TypeScript.** A Java/Spring port was evaluated on 2026-08-13 and
  judged not worth it: the valuable logic is already in SQL, load is trivial, and a port
  mainly means inventing the API seam that doesn't currently exist. If it is ever
  revisited, two traps: `lib/assign.ts` sorts codes with `localeCompare(…, {numeric:
  true})` (Java's `Collator` is not numeric-aware), and Postgres `round()` is
  half-away-from-zero vs Java's half-up, which disagrees on negative `norm_z`.
- **Auto-assign deals contiguous blocks** of the walking order, wrapping at the end. An
  earlier aisle-affinity heuristic measured as a no-op at usable settings and wrecked
  load balance beyond them — don't reintroduce it.
- **The app is multi-tenant.** `organisations` own events; `memberships` is the grant,
  and `admins` is only a profile row — so authorization joins events → memberships and
  never reaches `admins`. `requireAdmin()` proves identity only; ownership is proved by
  `getEventScope()` or by a scoped statement in `lib/sql/scoped.ts`.
- **Ownership is folded into the mutating statement**, not checked beforehand. A
  separate lookup costs a round trip and leaves a TOCTOU window, so the writes join
  through to `memberships` and the caller reads `rows.length === 0` as denial.
- **"Not found" and "not yours" are deliberately the same answer.** Distinguishing them
  turns the id space into an oracle for other organisers' events. Services return
  `not_found` for both; pages `notFound()`, and the API returns **404, never 403**.
- **`PUT /api/events/{id}/submissions/{posterId}` is idempotent by construction**, not by
  convention: `save_submission` upserts on `(judge, poster)` and replaces child rows
  wholesale. That is the same property the offline outbox depends on. Don't break either
  without breaking both.
- **The API is unversioned while it is browser-only.** The first external consumer earns
  `/api/v1`; adding it later is a directory move plus a rewrite rule. Bearer tokens are
  deferred — when they land, token-authenticated requests skip the same-origin check,
  because a token is never attached to a request ambiently.
- **`memberships` lives in the portable migration lane** (`0006`) with a bare
  `admin_id uuid`; the FK to `admins` is added in `0007`, the Supabase-only lane. That
  is the only reason the tenancy predicates are testable under PGlite — do not "tidy"
  the two migrations together.
- **Signup is still closed.** Organiser accounts need a row in `admins` *and* a
  membership, both inserted by hand for now. Invite-gated signup is the next phase; a
  new organisation may only ever come into existence by redeeming an invite whose
  `org_id` is null.

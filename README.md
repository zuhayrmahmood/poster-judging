# Poster Judging

Judges score posters from their phones while walking the aisles. Scores aggregate live
into an organiser dashboard with rankings, coverage gaps, and CSV export — replacing the
paper questionnaires and the hand arithmetic that followed them.

- **Judges** sign in with a short access code, work through an assigned walking order,
  and can revise their scores until the organiser closes judging.
- **Organisers** manage posters, judges, and the rubric; auto-assign judges to posters;
  and watch results update live.

Next.js 16 (App Router) · React 19 · Tailwind 4 · Supabase Postgres · deploys to Vercel.

## Setup

### 1. Create a Supabase project

Any region; the free tier is plenty. You need two things from it:

- **Project Settings → Database → Connection string** — the connection pooler URI. The
  app talks to Postgres directly; this is its only route to your data.
- **Project Settings → API** — the project URL and the `anon` key, used only to sign
  organisers in.

### 2. Configure the environment

```bash
cp .env.example .env.local
openssl rand -base64 48   # -> JUDGE_SESSION_SECRET
openssl rand -base64 32   # -> JUDGE_CODE_PEPPER
```

Use the **transaction pooler** URI (port 6543) for `DATABASE_URL`. Each serverless
instance opens its own pool, and the direct connection limit will not survive a hall of
judges arriving at once.

`JUDGE_CODE_PEPPER` is mixed into every access-code hash. **Changing it invalidates
every code that has been issued**, so set it once and leave it alone.

### 3. Run the migrations

```bash
npm run migrate
```

Applies anything in `supabase/migrations/` that has not been applied yet, tracked in a
`schema_migrations` table, each file in its own transaction. Re-running is a no-op.

Point `DATABASE_URL` at the **direct** connection (port 5432) for this one command —
DDL in a single transaction is what transaction-mode pooling is worst at.

```
0001_init.sql                    tables, RLS lockdown, login throttling
0002_views.sql                   aggregation views
0003_save_submission.sql         atomic score save
0004_supabase_auth.sql           admins table, privilege revokes
0005_login_attempts_by_code.sql  re-key throttling from IP to code
0006_organisations.sql           organisations, memberships, invites, events.org_id
0007_org_membership.sql          the FKs onto `admins`, and backfill
```

**Upgrading a project that predates this runner?** It has the schema but no bookkeeping
table, so migrate would try to create tables that already exist. Record the ones it
already has, once:

```bash
npm run migrate -- --baseline 0004_supabase_auth.sql
npm run migrate
```

Requires Postgres 15+ for `security_invoker` views — every current Supabase project
qualifies.


### 4. Create an organiser account

Authenticating with Supabase is not enough — a row in `admins` is what grants access.

1. Supabase dashboard → **Authentication → Users → Add user** (email + password,
   auto-confirm).
2. SQL Editor — an `admins` row says who you are, and a `memberships` row is what
   actually grants access to anything:

   ```sql
   insert into admins (id, email, name)
   select id, email, 'Your Name' from auth.users where email = 'you@example.com';

   insert into organisations (name, slug)
   values ('Your Organisation', 'your-organisation')
   on conflict (slug) do nothing;

   insert into memberships (org_id, admin_id, role)
   select o.id, a.id, 'owner'
     from organisations o, admins a
    where o.slug = 'your-organisation' and a.email = 'you@example.com';
   ```

This is the most common setup snag: without the `admins` row, `/admin` bounces straight
back to the login page even though sign-in succeeded. Without the `memberships` row you
get in, but every event is invisible — membership is the grant, so an organiser with no
membership owns nothing.

Events belong to organisations, and organisers only ever see their own. Two people
running two events on one deployment cannot read or touch each other's posters, judges,
rubric or results.

### 5. Run it

```bash
npm install
npm run seed   # optional: demo event, 12 posters, 5 judges — prints their codes
npm run dev
```

- `http://localhost:3000` — judge sign-in
- `http://localhost:3000/admin` — organiser dashboard

To try it on a real phone, `npm run dev -- --hostname 0.0.0.0` and browse to your
machine's LAN address. Emulators hide the two things that actually matter: real
tap-target size and one-handed reach.

That LAN address only works because `allowedDevOrigins` in `next.config.ts` lists the
private IP ranges. Next 16 otherwise serves dev-only assets to `localhost` alone, and
the failure is quiet and misleading: the page renders fine, but React never hydrates,
so the sign-in button stays greyed out no matter what code you type. If you test from a
subnet outside `192.168.*.*`, `10.*.*.*` or `172.16.*.*`, add it there. Production
(`next start`) ignores the setting entirely.

## Running an event

1. **Settings** — create the event, set judges per poster.
2. **Rubric** — define criteria. Weights are relative and need not total 100; each
   criterion is scored out of its own maximum, so 1–5 and 1–10 criteria can coexist.
3. **Posters** — add individually or paste CSV (`code,title,presenters,location`,
   presenters separated by `;`).
4. **Judges** — add them, then use **New codes for all + print** to produce the cards.
   Codes are stored only as hashes, so printing necessarily issues fresh ones — that
   guarantees the sheet in your hand matches what the database accepts.
5. **Assignments** — review the proposed per-judge load, then assign.
6. **Settings → Open judging.**
7. Watch the dashboard. The **Below target** count tells you where to send the next
   judge, which is the single most useful number during a live session.
8. **Settings → Close judging** when the session ends, then export CSV.

## The API

Every resource is reachable over REST as well as through the app's own UI. The spec is
`openapi.json`, served at `/api/openapi.json`.

```
GET    /api/orgs                                     organisations you belong to
GET    /api/orgs/{orgId}/events                      events in one
POST   /api/orgs/{orgId}/events                      create an event
GET    /api/events/{eventId}                         one event
PATCH  /api/events/{eventId}                         rename, retarget, open/close judging
GET    /api/events/{eventId}/posters                 list, create, import, delete
POST   /api/events/{eventId}/posters/import          bulk CSV (text/csv body)
GET    /api/events/{eventId}/judges                  list, add, deactivate, delete
POST   /api/events/{eventId}/judges/codes            rotate all, for the card sheet
GET    /api/events/{eventId}/criteria                the rubric
GET    /api/events/{eventId}/assignments             the plan
PUT    /api/events/{eventId}/assignments             auto-assign (replaces the set)
GET    /api/events/{eventId}/results?mode=raw        ranked results + judge progress
PUT    /api/events/{eventId}/submissions/{posterId}  a judge saves one sheet
```

Four things to know before calling it:

- **Same-origin only.** There are no API tokens yet. Admin endpoints use the Supabase
  session cookie, the judge endpoints use `pj_judge`, and every mutating request must
  carry `Sec-Fetch-Site: same-origin` or an `Origin` matching the host — otherwise 403.
  Server Actions get that check from Next automatically; Route Handlers do not, so it is
  enforced by hand.
- **Cross-tenant access is 404, never 403.** A 403 would confirm a resource exists,
  letting a caller probe for other organisers' ids.
- **`PUT` on a submission is safe to replay.** The write upserts on `(judge, poster)` and
  replaces the score rows wholesale, so a retry overwrites rather than double-counting —
  which is exactly what the offline outbox relies on.
- **Unjudged is not zero.** A poster nobody has scored returns null `raw_pct`/`norm_z` and
  is unranked. Don't coerce those to 0.

Opening and closing judging is `PATCH /api/events/{id}` with `{"status": "active"}` —
there is no `/open` or `/close`, because the state belongs to the event.

## How results are computed

Each criterion is normalised to a fraction of its own maximum, weighted, and summed into
a 0–100% total per score sheet. A poster's **Raw** score is the plain average of those
totals across judges — the number you would have got on paper, and the one to show
presenters.

**Normalized** expresses each score as how far above or below that judge's own average
it sits, then averages those. This matters because no two posters are seen by the same
set of judges, so a poster that happened to draw harsh judges is otherwise penalised.

Two edge cases, both deliberate and both covered by tests:

- A judge with fewer than two submissions, or who scored everything identically, has no
  spread to measure. They count as neutral rather than as `NaN`.
- A poster nobody has judged yet is **unranked**, not zero — it has no score, which is
  different from a score of zero.

`lib/scoring.ts` mirrors this arithmetic in TypeScript for the judge-side preview.
`tests/scoring.test.ts` pins it to the same fixture used to verify the SQL views, so the
two cannot drift apart silently.

## Security model

Every table is RLS-enabled with **no policies**, which denies the `anon` and
`authenticated` roles outright, and table privileges are revoked from both. All reads and
writes go through server code over a direct Postgres connection, as the role that owns
the tables and therefore bypasses RLS, after that code has checked authorization itself.
A leaked anon key therefore exposes nothing — it can sign a user in and nothing more.

Consequences worth knowing:

- The browser cannot use Supabase Realtime. The dashboard polls every 15s instead, which
  is simpler and well within free-tier limits.
- `proxy.ts` is a first-pass redirect, not the boundary. Server Actions are reachable by
  direct POST, so each one re-checks the session, and `save_submission` re-verifies in
  SQL that the poster belongs to the judge's event and that judging is still open.

Access codes are 8 characters of Crockford base32 minus `0`/`1` (~39 bits), stored as a
peppered SHA-256. A fast hash is correct here — the code is uniformly random, so there is
no dictionary to attack, and an indexed hash gives O(1) lookup. Online guessing is capped
at 10 failures per *code* per 15 minutes — keyed on the code rather than the client IP,
because a hall of judges on venue wifi shares one IP and would throttle each other.

Judges may score **any poster in their own event**, not only assigned ones. The
assignment list is a suggested walking order, and a judge who wanders to a neighbouring
poster must still be able to submit. Crossing into a different event is what is blocked.

## Offline behaviour

Poster halls have bad wifi, so the scoring form assumes it will lose the network:

- Every tap writes the sheet to `localStorage` immediately, plus a debounced draft save
  to the server.
- A failed submit goes into an outbox and the judge moves on. A banner shows what is
  pending; it retries every 20s and on the `online` event.
- Replays are safe — `save_submission` upserts on `(judge, poster)` and replaces the
  child score rows, so a duplicate delivery overwrites rather than double-counting.

## Commands

```bash
npm run dev     # dev server
npm run build   # production build
npm test        # unit tests (scoring, access codes, assignment, SQL views)
npm run migrate # apply pending migrations
npm run seed    # reset and reseed the demo event
npm run lint
```

## Deploying to Vercel

Import the repo, set the five variables from `.env.example` in project settings, deploy.
Everything is server-rendered on demand; there is nothing to configure beyond that.

Two free-tier notes:

- **Supabase pauses a free project after 7 days of inactivity.** Open the dashboard the
  day before your event — a cold project on event morning is the one failure mode that
  takes the whole thing down.
- **Vercel Hobby forbids commercial use.** Fine for a university or club event; a company
  running this needs a Pro plan.

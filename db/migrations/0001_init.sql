-- Poster judging platform: core schema.
--
-- Ported from the Supabase schema. Two things are deliberately gone:
--
--   * The RLS deny-all lockdown and the anon/authenticated revokes. Those defended a
--     publicly-reachable PostgREST endpoint. The database is now embedded in the
--     application process (PGlite, single connection, on the organiser's disk) and has
--     no network surface at all, so there is no role to deny.
--   * The `admins` table, which keyed off Supabase `auth.users`. Admin access is now the
--     capability of holding the desktop window's token — see lib/auth/admin.ts.

create type event_status as enum ('draft', 'active', 'locked');
create type submission_status as enum ('draft', 'submitted');

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

create table events (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  slug                     text not null unique,
  status                   event_status not null default 'draft',
  -- How many judges each poster should ideally see. Drives the dashboard's
  -- coverage warning, which is what tells an admin where to send the next judge.
  target_judges_per_poster int not null default 3 check (target_judges_per_poster > 0),
  created_at               timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Event content
-- ---------------------------------------------------------------------------

create table posters (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events (id) on delete cascade,
  code            text not null,                        -- e.g. 'A-17', shown on the board
  title           text not null,
  presenter_names text[] not null default '{}',
  abstract        text,
  location        text,                                 -- aisle or booth, e.g. 'A'
  created_at      timestamptz not null default now(),
  unique (event_id, code)
);

-- Judges walk the hall in physical order, so listing by location then code is the
-- default read pattern for both the assignment list and auto-assign.
create index posters_event_location_idx on posters (event_id, location, code);

create table judges (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events (id) on delete cascade,
  name       text not null,
  email      text,
  -- Peppered SHA-256 of the normalized access code. The plaintext is shown to the
  -- admin once at generation time and is not recoverable afterwards.
  code_hash  text not null unique,
  code_hint  text not null,                             -- last 4 chars, for admin display
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index judges_event_idx on judges (event_id);

create table criteria (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events (id) on delete cascade,
  label       text not null,
  description text,
  weight      numeric not null default 1 check (weight > 0),
  max_score   int not null default 5 check (max_score between 2 and 100),
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create index criteria_event_order_idx on criteria (event_id, sort_order);

-- ---------------------------------------------------------------------------
-- Assignments and scoring
-- ---------------------------------------------------------------------------

create table assignments (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events (id) on delete cascade,
  judge_id   uuid not null references judges (id) on delete cascade,
  poster_id  uuid not null references posters (id) on delete cascade,
  sort_order int not null default 0,                    -- walking order for this judge
  created_at timestamptz not null default now(),
  unique (judge_id, poster_id)
);

create index assignments_judge_order_idx on assignments (judge_id, sort_order);
create index assignments_poster_idx on assignments (poster_id);

-- One row per (judge, poster). The unique constraint makes submit a clean upsert,
-- which in turn makes the client's offline retry queue idempotent: replaying a queued
-- submission overwrites rather than double-counting.
create table submissions (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events (id) on delete cascade,
  judge_id     uuid not null references judges (id) on delete cascade,
  poster_id    uuid not null references posters (id) on delete cascade,
  status       submission_status not null default 'draft',
  comment      text,
  submitted_at timestamptz,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (judge_id, poster_id)
);

create index submissions_event_poster_idx on submissions (event_id, poster_id);
create index submissions_judge_status_idx on submissions (judge_id, status);

-- Scores live in a child table rather than JSONB so aggregation happens in SQL.
create table submission_scores (
  submission_id uuid not null references submissions (id) on delete cascade,
  criterion_id  uuid not null references criteria (id) on delete cascade,
  value         int not null check (value >= 0),
  primary key (submission_id, criterion_id)
);

-- ---------------------------------------------------------------------------
-- Login throttling
--
-- Keyed on the peppered hash of the code that was typed, NOT on client IP. Every judge
-- reaches this server directly over the venue LAN, so the Vercel-era `x-forwarded-for`
-- key collapsed to a single value for the whole room: ten mistyped codes anywhere in
-- the hall would have locked out every judge at once. Keying on the attempted code
-- throttles brute force against one code while leaving everyone else unaffected.
-- ---------------------------------------------------------------------------

create table login_attempts (
  id           bigserial primary key,
  code_hash    text not null,
  attempted_at timestamptz not null default now()
);

create index login_attempts_code_time_idx on login_attempts (code_hash, attempted_at desc);

create or replace function prune_login_attempts()
returns void
language sql
as $$
  delete from login_attempts where attempted_at < now() - interval '1 day';
$$;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger submissions_set_updated_at
  before update on submissions
  for each row execute function set_updated_at();

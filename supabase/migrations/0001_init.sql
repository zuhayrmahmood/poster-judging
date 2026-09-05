-- Poster judging platform: core schema.
--
-- Security posture: every table below is RLS-enabled with *no policies*, which denies
-- the `anon` and `authenticated` roles outright. Supabase exposes these tables through
-- PostgREST whether or not this app uses it, so that lockdown is what stands between a
-- leaked anon key and the whole database. The app itself connects over a direct
-- connection string as the table owner, and an owner bypasses RLS — see lib/db/client.ts.
--
-- 0004_supabase_auth.sql adds the parts that only make sense on Supabase: the `admins`
-- table (which references `auth.users`) and the privilege revokes. Keeping them out of
-- this file is what lets tests/schema.test.ts run 0001-0003 against a plain Postgres.

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
-- Keyed on the peppered hash of the code that was typed, NOT on client IP. A hall of
-- judges shares one venue IP, so an IP key means ten mistyped codes anywhere in the
-- room lock out everyone for the window — the failure mode recorded as KNOWN-ISSUES #3.
-- Keying on the attempted code throttles brute force against a single code while
-- leaving every other judge unaffected.
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

-- ---------------------------------------------------------------------------
-- Lock down everything
-- ---------------------------------------------------------------------------

alter table events            enable row level security;
alter table posters           enable row level security;
alter table judges            enable row level security;
alter table criteria          enable row level security;
alter table assignments       enable row level security;
alter table submissions       enable row level security;
alter table submission_scores enable row level security;
alter table login_attempts    enable row level security;

-- No policies are defined on purpose: RLS with zero policies denies everything to
-- anon and authenticated. The app's own connection owns these tables and so is not
-- subject to them.

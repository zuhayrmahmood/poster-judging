-- Poster judging platform: core schema.
--
-- Security posture: every table below is RLS-enabled with *no policies*, which denies
-- the `anon` and `authenticated` roles outright. All access goes through Next.js server
-- code using the service-role key, which bypasses RLS, after that code has checked
-- authorization itself. A leaked anon key therefore exposes nothing.

create extension if not exists pgcrypto;

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

-- Admins are Supabase Auth users; membership in this table is what grants access.
create table admins (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  name       text,
  created_at timestamptz not null default now()
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
-- Postgres-backed because Vercel Hobby has no Redis. Volume is trivial: a few hundred
-- rows per event, pruned by the cleanup function below.
-- ---------------------------------------------------------------------------

create table login_attempts (
  id           bigserial primary key,
  ip           inet not null,
  attempted_at timestamptz not null default now()
);

create index login_attempts_ip_time_idx on login_attempts (ip, attempted_at desc);

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
alter table admins            enable row level security;
alter table posters           enable row level security;
alter table judges            enable row level security;
alter table criteria          enable row level security;
alter table assignments       enable row level security;
alter table submissions       enable row level security;
alter table submission_scores enable row level security;
alter table login_attempts    enable row level security;

-- No policies are defined on purpose: RLS with zero policies denies everything to
-- anon and authenticated. Only the service role, which bypasses RLS, can read or write.

-- Belt and braces. Supabase grants table privileges to anon/authenticated by default,
-- and a plain view is not itself RLS-protected — revoking outright closes that gap for
-- the views created in 0002.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Multi-tenancy: organisations own events, memberships grant access.
--
-- Deliberately in the *portable* lane, alongside 0001-0003 and 0005, so that
-- tests/schema.test.ts can run it against in-memory Postgres. That is only possible
-- because `memberships.admin_id` is a bare uuid here: the foreign key to `admins`
-- (which references Supabase's `auth.users`) is added in 0007, the Supabase-only lane.
--
-- Keeping the split this way round is what makes the tenancy boundary testable. Every
-- authorization predicate the app runs joins events -> memberships, and all of that is
-- executable under PGlite. If this table lived in the Supabase-only lane, the one part
-- of the system that must never regress would be the one part with no test coverage.

create type membership_role as enum ('owner', 'admin');

-- ---------------------------------------------------------------------------
-- Organisations and membership
-- ---------------------------------------------------------------------------

create table organisations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now()
);

-- Membership is the grant. `admins` is only a profile row — being in it says who you
-- are, not what you may touch. Authorization therefore never has to join `admins`.
create table memberships (
  org_id     uuid not null references organisations (id) on delete cascade,
  admin_id   uuid not null,
  role       membership_role not null default 'admin',
  created_at timestamptz not null default now(),
  primary key (org_id, admin_id)
);

-- The hot path is "which orgs does this caller belong to", keyed by admin.
create index memberships_admin_idx on memberships (admin_id);

-- ---------------------------------------------------------------------------
-- Events belong to an organisation
-- ---------------------------------------------------------------------------

alter table events add column org_id uuid references organisations (id) on delete cascade;

-- Backfill: everything that exists today belongs to one bootstrap org. Guarded on
-- there being events at all, so a fresh database does not acquire a stray org.
insert into organisations (name, slug)
select 'Default organisation', 'default'
where exists (select 1 from events);

update events
   set org_id = (select id from organisations where slug = 'default')
 where org_id is null;

-- Safe on an empty database: the update above touched nothing and this holds vacuously.
alter table events alter column org_id set not null;

create index events_org_idx on events (org_id, created_at desc);

-- Slug uniqueness moves inside the organisation. Two organisers must both be able to
-- run "expo-2026", and a globally unique slug would also leak that the other's exists.
alter table events drop constraint events_slug_key;
alter table events add constraint events_org_slug_key unique (org_id, slug);

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------

-- `org_id` is nullable on purpose, and the null carries meaning: redeeming an invite
-- with no org mints a brand-new organisation with the redeemer as its owner. That is
-- the only way a new organisation can come into existence, which is what keeps signup
-- closed. An invite that names an org adds a co-organiser to it instead.
--
-- created_by/used_by are bare uuids for the same reason as memberships.admin_id.
create table org_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references organisations (id) on delete cascade,
  email       text not null,
  role        membership_role not null default 'admin',
  -- Peppered hash, same treatment as judge codes: the plaintext is shown once and is
  -- not recoverable. Uses its own pepper so rotating JUDGE_CODE_PEPPER, which is
  -- documented as invalidating every judge code, does not also void every invite.
  code_hash   text not null unique,
  code_hint   text not null,
  created_by  uuid,
  expires_at  timestamptz not null default now() + interval '14 days',
  used_at     timestamptz,
  used_by     uuid,
  created_at  timestamptz not null default now()
);

create index org_invites_org_idx on org_invites (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Lock down, same posture as 0001
-- ---------------------------------------------------------------------------

alter table organisations enable row level security;
alter table memberships   enable row level security;
alter table org_invites   enable row level security;

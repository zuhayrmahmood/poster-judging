-- The Supabase-specific half of the schema.
--
-- Split out from 0001 because everything here needs a real Supabase project: the
-- `auth.users` table, and the `anon` / `authenticated` roles. tests/schema.test.ts runs
-- 0001-0003 against a plain in-memory Postgres and skips this file, which is only
-- possible while that split holds — keep Supabase-only DDL in here.

-- ---------------------------------------------------------------------------
-- Organisers
-- ---------------------------------------------------------------------------

-- Authenticating with Supabase is not enough on its own: anyone can sign up against a
-- public project. Membership in this table is what grants access, and it can only be
-- granted by someone who already has database access.
create table admins (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  name       text,
  created_at timestamptz not null default now()
);

alter table admins enable row level security;

-- ---------------------------------------------------------------------------
-- Privilege revokes
-- ---------------------------------------------------------------------------

-- Belt and braces over the RLS deny-all in 0001. Supabase grants table privileges to
-- anon/authenticated by default, and a view is not itself RLS-protected — revoking
-- outright closes that gap for the views created in 0002.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

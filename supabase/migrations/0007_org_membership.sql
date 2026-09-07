-- The Supabase-specific half of the tenancy schema.
--
-- Split from 0006 for the same reason 0004 is split from 0001: everything here depends
-- on `admins`, which references `auth.users`. tests/schema.test.ts runs 0006 but skips
-- this file, and that only works while the split holds — keep Supabase-only DDL here.

-- ---------------------------------------------------------------------------
-- Close the foreign keys 0006 deliberately left open
-- ---------------------------------------------------------------------------

alter table memberships
  add constraint memberships_admin_id_fkey
  foreign key (admin_id) references admins (id) on delete cascade;

alter table org_invites
  add constraint org_invites_created_by_fkey
  foreign key (created_by) references admins (id) on delete set null;

alter table org_invites
  add constraint org_invites_used_by_fkey
  foreign key (used_by) references admins (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Backfill existing organisers
-- ---------------------------------------------------------------------------

-- 0006 only creates the bootstrap org when events exist. A project that has organisers
-- but no events yet still needs one, or the backfill below has nothing to attach to.
insert into organisations (name, slug)
select 'Default organisation', 'default'
 where exists (select 1 from admins)
   and not exists (select 1 from organisations where slug = 'default');

-- Every organiser who already had access becomes an owner of the one existing org, so
-- nobody is locked out by the migration.
insert into memberships (org_id, admin_id, role)
select o.id, a.id, 'owner'
  from organisations o
 cross join admins a
 where o.slug = 'default'
on conflict do nothing;

-- Re-key login throttling from client IP to the code that was typed.
--
-- A hall of judges on shared venue wifi presents a single public IP, so an IP key meant
-- ten mistyped codes anywhere in the room throttled everyone for the window. Keying on
-- the peppered hash of the attempted code caps brute force against one code and leaves
-- every other judge unaffected.
--
-- Existing rows are discarded rather than converted: an IP cannot be turned into a code
-- hash, and these rows are throttling state that prune_login_attempts() drops daily.
--
-- Written to be a no-op on a database already created from 0001, so the same file is
-- correct whether it runs against a fresh project or one predating the change.

delete from login_attempts;

drop index if exists login_attempts_ip_time_idx;
alter table login_attempts drop column if exists ip;
alter table login_attempts add column if not exists code_hash text not null;

create index if not exists login_attempts_code_time_idx
  on login_attempts (code_hash, attempted_at desc);

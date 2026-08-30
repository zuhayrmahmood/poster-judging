-- Atomic save for a score sheet.
--
-- Doing this in one function rather than three round-trips from the app buys two things:
-- the submission row and its child scores can never be left half-written, and the
-- authorization invariants live next to the data they protect.
--
-- The server action checks the judge's session cookie first; these checks are the
-- second line.

create or replace function save_submission(
  p_judge_id  uuid,
  p_poster_id uuid,
  p_status    submission_status,
  p_comment   text,
  p_scores    jsonb  -- { "<criterion_id>": <value>, ... }
)
returns uuid
language plpgsql
as $$
declare
  v_event_id      uuid;
  v_poster_event  uuid;
  v_event_status  event_status;
  v_submission_id uuid;
begin
  select event_id into v_event_id
  from judges
  where id = p_judge_id and active;

  if v_event_id is null then
    raise exception 'judge_not_found' using errcode = 'P0001';
  end if;

  -- A judge may score any poster in their own event, not only assigned ones: the
  -- assignment list is a guided walking order, and a judge who wanders to a
  -- neighbouring poster must still be able to submit. Crossing into a *different*
  -- event is what is actually forbidden.
  select event_id into v_poster_event from posters where id = p_poster_id;

  if v_poster_event is null or v_poster_event <> v_event_id then
    raise exception 'poster_not_in_event' using errcode = 'P0001';
  end if;

  select status into v_event_status from events where id = v_event_id;

  if v_event_status <> 'active' then
    raise exception 'event_not_active' using errcode = 'P0001';
  end if;

  insert into submissions (event_id, judge_id, poster_id, status, comment, submitted_at)
  values (
    v_event_id, p_judge_id, p_poster_id, p_status, nullif(trim(p_comment), ''),
    case when p_status = 'submitted' then now() end
  )
  on conflict (judge_id, poster_id) do update
    set status  = excluded.status,
        comment = excluded.comment,
        -- Preserve the original submission time across later edits, so the admin can
        -- still see when a poster was first judged.
        submitted_at = case
          when excluded.status = 'submitted'
            then coalesce(submissions.submitted_at, now())
          else null
        end
  returning id into v_submission_id;

  -- Replace wholesale. The payload is always the complete sheet, so this also clears
  -- a criterion the judge deselected, and makes a replayed offline submission
  -- idempotent rather than additive.
  delete from submission_scores where submission_id = v_submission_id;

  insert into submission_scores (submission_id, criterion_id, value)
  select
    v_submission_id,
    c.id,
    -- Clamp rather than reject: the client is untrusted, and a value out of range is
    -- not worth failing a judge's whole submission over mid-event.
    least(greatest(s.value::int, 0), c.max_score)
  from jsonb_each_text(p_scores) as s(key, value)
  join criteria c
    on c.id = s.key::uuid
   and c.event_id = v_event_id
  -- Guard the cast: `key` comes from the client, and a non-UUID string would abort
  -- the whole statement before the join could filter it out.
  where s.key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    and s.value ~ '^-?[0-9]+$';

  return v_submission_id;
end;
$$;

-- Aggregation views. These are the whole point of the app: the arithmetic the admins
-- used to do by hand after collecting paper sheets.
--
-- lib/scoring.ts mirrors this math in TypeScript for the judge-side preview and for
-- unit tests. Change one, change the other.
--
-- Ported verbatim from the Supabase schema apart from the `security_invoker` clause and
-- the trailing revokes, which existed to stop these views reading past RLS on behalf of
-- the anon role. There is no anon role any more.

-- ---------------------------------------------------------------------------
-- One weighted total per submitted score sheet, as a 0-100 percentage.
--
-- Each criterion is normalized to a fraction of its own max_score before weighting,
-- so an event can mix 1-5 and 1-10 criteria and weights need not sum to 100.
-- ---------------------------------------------------------------------------

create view v_submission_totals as
select
  s.id       as submission_id,
  s.event_id,
  s.judge_id,
  s.poster_id,
  100.0 * sum(ss.value::numeric / c.max_score * c.weight)
        / nullif(sum(c.weight), 0) as pct
from submissions s
join submission_scores ss on ss.submission_id = s.id
join criteria c           on c.id = ss.criterion_id
where s.status = 'submitted'
group by s.id;

-- ---------------------------------------------------------------------------
-- Each judge's own mean and spread, used to correct for harsh vs. lenient judging.
-- Necessary because no two posters are seen by the same set of judges.
-- ---------------------------------------------------------------------------

create view v_judge_stats as
select
  judge_id,
  event_id,
  avg(pct)         as mean_pct,
  stddev_samp(pct) as sd_pct,
  count(*)         as n
from v_submission_totals
group by judge_id, event_id;

-- ---------------------------------------------------------------------------
-- Per-poster results: the dashboard's primary table.
--
-- `raw_pct` is the plain weighted average across judges — the number that matches what
-- admins computed on paper, and the one to show presenters.
--
-- `norm_z` averages each judge's z-score for the poster. A judge with fewer than two
-- submissions, or who gave every poster the same score, has no meaningful spread; they
-- contribute a neutral 0 rather than NULL, so they neither help nor hurt the ranking.
-- Surface that caveat in the dashboard so admins do not over-read the column.
--
-- LEFT JOIN so posters nobody has judged yet still appear, with n_judges = 0.
-- ---------------------------------------------------------------------------

create view v_poster_results as
select
  p.id       as poster_id,
  p.event_id,
  p.code,
  p.title,
  p.location,
  count(t.submission_id)                          as n_judges,
  round(avg(t.pct), 2)                            as raw_pct,
  round(avg(
    case
      -- No submission at all (the LEFT JOIN found nothing). Must be NULL, not 0:
      -- avg() skips NULLs, so an unjudged poster ends up with norm_z = NULL rather
      -- than sorting into the middle of the normalized ranking as an average poster.
      when t.submission_id is null then null
      when js.n >= 2 and coalesce(js.sd_pct, 0) > 0
        then (t.pct - js.mean_pct) / js.sd_pct
      -- Judge has no usable spread; contribute neutrally instead of poisoning the avg.
      else 0
    end
  ), 3)                                           as norm_z
from posters p
left join v_submission_totals t on t.poster_id = p.id
left join v_judge_stats js      on js.judge_id  = t.judge_id
group by p.id;

-- ---------------------------------------------------------------------------
-- Per-judge progress, so an admin can spot a judge who has stalled mid-event.
-- ---------------------------------------------------------------------------

create view v_judge_progress as
select
  j.id       as judge_id,
  j.event_id,
  j.name,
  j.code_hint,
  j.active,
  count(distinct a.poster_id)                                            as assigned,
  count(distinct s.poster_id) filter (where s.status = 'submitted')      as submitted
from judges j
left join assignments a on a.judge_id = j.id
left join submissions s on s.judge_id = j.id
group by j.id;

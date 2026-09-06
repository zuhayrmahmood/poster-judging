/**
 * Tenant-scoped SQL.
 *
 * Every statement here folds the ownership check into the statement that reads or
 * writes, rather than doing a lookup first and trusting it. Two reasons, both of which
 * matter once a second organiser exists:
 *
 *   * **No TOCTOU window.** A separate "do you own this?" query leaves a gap in which
 *     the row can be reparented between the check and the write.
 *   * **No extra round trip.** These run on every admin mutation.
 *
 * The shape is always the same: join the target through `events` to `memberships`, and
 * require a membership row for the calling admin. A caller who owns nothing simply
 * affects zero rows, so the adapter reads `rows.length === 0` as "not found *or* not
 * yours" and reports the two identically. Distinguishing them would turn the id space
 * into an oracle for which events exist.
 *
 * Deliberately a **pure module** — strings only, no imports, no `server-only`. That is
 * what lets tests/tenancy.test.ts execute the exact text the actions run against an
 * in-memory Postgres. A test that re-typed these queries would prove nothing about the
 * queries that actually ship.
 *
 * Membership is the grant (see supabase/migrations/0006_organisations.sql), so none of
 * these ever needs to join `admins`.
 */

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

/** $1 eventId, $2 adminId. Zero rows means "no such event, or not yours". */
export const SELECT_EVENT_SCOPE = `
  select e.id as event_id, e.org_id, m.role
    from events e
    join memberships m on m.org_id = e.org_id
   where e.id = $1
     and m.admin_id = $2`;

/** $1 adminId. Zero rows means the caller belongs to no organisation yet. */
export const SELECT_ORG_SCOPE = `
  select o.id as org_id, o.name, o.slug, m.role
    from organisations o
    join memberships m on m.org_id = o.id
   where o.id = $1
     and m.admin_id = $2`;

/** $1 adminId. Every org the caller belongs to, for the picker. */
export const LIST_ORGS_FOR_ADMIN = `
  select o.id, o.name, o.slug, o.created_at, m.role
    from organisations o
    join memberships m on m.org_id = o.id
   where m.admin_id = $1
   order by o.name`;

/** $1 adminId. Every event the caller can reach, newest and active first. */
export const LIST_EVENTS_FOR_ADMIN = `
  select e.*
    from events e
    join memberships m on m.org_id = e.org_id
   where m.admin_id = $1
   order by (e.status = 'active') desc, e.created_at desc`;

/**
 * $1 adminId. The single event the dashboard shows while the UI is one-event-at-a-time.
 *
 * The predecessor of this query took no arguments at all and returned one global row
 * for every admin on the platform, which is what made a second organiser a security
 * bug rather than a missing feature.
 */
export const SELECT_PRIMARY_EVENT_FOR_ADMIN = `
  select e.*
    from events e
    join memberships m on m.org_id = e.org_id
   where m.admin_id = $1
   order by (e.status = 'active') desc, e.created_at desc
   limit 1`;

// ---------------------------------------------------------------------------
// Posters
// ---------------------------------------------------------------------------

/** $1 posterId, $2 adminId. */
export const SELECT_OWNED_POSTER = `
  select p.*
    from posters p
    join events e on e.id = p.event_id
    join memberships m on m.org_id = e.org_id
   where p.id = $1
     and m.admin_id = $2`;

/** $1 posterId, $2 adminId. */
export const DELETE_OWNED_POSTER = `
  delete from posters p
   using events e, memberships m
   where p.id = $1
     and e.id = p.event_id
     and m.org_id = e.org_id
     and m.admin_id = $2
  returning p.id`;

// ---------------------------------------------------------------------------
// Judges
// ---------------------------------------------------------------------------

/**
 * $1 judgeId, $2 code_hash, $3 code_hint, $4 adminId.
 *
 * The privilege-escalation case. Unscoped, this hands the caller a working plaintext
 * code for a judge in someone else's event *and* locks that event's real judge out,
 * because the old hash is gone and the plaintext was never stored.
 */
export const ROTATE_OWNED_JUDGE_CODE = `
  update judges j
     set code_hash = $2, code_hint = $3
    from events e, memberships m
   where j.id = $1
     and e.id = j.event_id
     and m.org_id = e.org_id
     and m.admin_id = $4
  returning j.id`;

/** $1 judgeId, $2 active, $3 adminId. */
export const SET_OWNED_JUDGE_ACTIVE = `
  update judges j
     set active = $2
    from events e, memberships m
   where j.id = $1
     and e.id = j.event_id
     and m.org_id = e.org_id
     and m.admin_id = $3
  returning j.id`;

/** $1 judgeId, $2 adminId. */
export const DELETE_OWNED_JUDGE = `
  delete from judges j
   using events e, memberships m
   where j.id = $1
     and e.id = j.event_id
     and m.org_id = e.org_id
     and m.admin_id = $2
  returning j.id`;

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

/** $1 criterionId, $2 label, $3 description, $4 weight, $5 max_score, $6 adminId. */
export const UPDATE_OWNED_CRITERION = `
  update criteria c
     set label = $2, description = $3, weight = $4, max_score = $5
    from events e, memberships m
   where c.id = $1
     and e.id = c.event_id
     and m.org_id = e.org_id
     and m.admin_id = $6
  returning c.id`;

/** $1 criterionId, $2 adminId. */
export const DELETE_OWNED_CRITERION = `
  delete from criteria c
   using events e, memberships m
   where c.id = $1
     and e.id = c.event_id
     and m.org_id = e.org_id
     and m.admin_id = $2
  returning c.id`;

// ---------------------------------------------------------------------------
// Poster drill-down
// ---------------------------------------------------------------------------

/**
 * $1 posterId, $2 adminId. Every submitted sheet for one poster, ownership-checked.
 *
 * The unscoped version of this rendered any poster's full per-judge score sheets to
 * any signed-in organiser who could guess a UUID.
 */
export const SELECT_OWNED_POSTER_SHEETS = `
  select s.id          as submission_id,
         s.judge_id,
         j.name        as judge_name,
         s.comment,
         s.submitted_at,
         t.pct,
         (select jsonb_object_agg(ss.criterion_id, ss.value)
            from submission_scores ss
           where ss.submission_id = s.id) as scores
    from submissions s
    join judges j on j.id = s.judge_id
    join posters p on p.id = s.poster_id
    join events e on e.id = p.event_id
    join memberships m on m.org_id = e.org_id
    left join v_submission_totals t on t.submission_id = s.id
   where s.poster_id = $1
     and m.admin_id = $2
     and s.status = 'submitted'
   order by j.name`;

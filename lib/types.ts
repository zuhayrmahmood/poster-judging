/**
 * Domain types mirroring supabase/migrations. Hand-written rather than generated so
 * the repo builds without a live Supabase project; regenerate with
 * `supabase gen types typescript` if you prefer that workflow.
 */

export type EventStatus = "draft" | "active" | "locked";
export type SubmissionStatus = "draft" | "submitted";
export type MembershipRole = "owner" | "admin";

export type Organisation = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
};

/**
 * Membership is the grant: `admins` says who someone is, this says what they may touch.
 * Authorization joins events -> memberships and never has to reach `admins`.
 */
export type Membership = {
  org_id: string;
  admin_id: string;
  role: MembershipRole;
  created_at: string;
};

/** `org_id` null means redeeming this invite mints a new organisation. */
export type OrgInvite = {
  id: string;
  org_id: string | null;
  email: string;
  role: MembershipRole;
  code_hint: string;
  created_by: string | null;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
  created_at: string;
};

export type Event = {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  status: EventStatus;
  target_judges_per_poster: number;
  created_at: string;
};

export type Poster = {
  id: string;
  event_id: string;
  code: string;
  title: string;
  presenter_names: string[];
  abstract: string | null;
  location: string | null;
  created_at: string;
};

export type Judge = {
  id: string;
  event_id: string;
  name: string;
  email: string | null;
  code_hint: string;
  active: boolean;
  created_at: string;
};

export type Criterion = {
  id: string;
  event_id: string;
  label: string;
  description: string | null;
  weight: number;
  max_score: number;
  sort_order: number;
};

export type Assignment = {
  id: string;
  event_id: string;
  judge_id: string;
  poster_id: string;
  sort_order: number;
};

export type Submission = {
  id: string;
  event_id: string;
  judge_id: string;
  poster_id: string;
  status: SubmissionStatus;
  comment: string | null;
  submitted_at: string | null;
  updated_at: string;
};

export type SubmissionScore = {
  submission_id: string;
  criterion_id: string;
  value: number;
};

/** Row shape of the v_poster_results view. */
export type PosterResult = {
  poster_id: string;
  event_id: string;
  code: string;
  title: string;
  location: string | null;
  n_judges: number;
  raw_pct: number | null;
  norm_z: number | null;
};

/** A judge's assignment list row, joined with their submission state. */
export type AssignmentRow = {
  poster: Poster;
  status: SubmissionStatus | "not_started";
  updated_at: string | null;
};

/** What the scoring form posts. `scores` maps criterion_id -> value. */
export type ScorePayload = {
  posterId: string;
  scores: Record<string, number>;
  comment: string;
};

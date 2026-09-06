import { getAdmin } from "@/lib/auth/admin";
import { csvResponse, toCsv } from "@/lib/csv";
import { query } from "@/lib/db";
import {
  getCriteria,
  getPrimaryEventForAdmin,
  getResults,
} from "@/lib/data/admin";

/**
 * CSV export. `?type=raw` gives one row per judge per poster with every individual
 * criterion score, so organisers can still audit the arithmetic by hand — which is the
 * whole thing this app replaces, and the first question someone will ask when a result
 * looks surprising.
 */
export async function GET(request: Request) {
  // In practice proxy.ts redirects unauthenticated browser navigations here before this
  // runs, which is the right behaviour for a plain download link. This check is the
  // backstop for anything that reaches the handler without passing through the proxy;
  // it returns 401 rather than redirecting so a non-browser caller gets a status it can
  // act on instead of a login page body.
  const admin = await getAdmin();
  if (!admin) return new Response("Unauthorized", { status: 401 });

  // Scoped to the caller: this used to export whichever event happened to be active
  // platform-wide, which for a second organiser meant someone else's results.
  const event = await getPrimaryEventForAdmin(admin.id);
  if (!event) return new Response("No event", { status: 404 });

  const type = new URL(request.url).searchParams.get("type");
  const stamp = new Date().toISOString().slice(0, 10);

  if (type === "raw") {
    const criteria = await getCriteria(event.id);

    type RawRow = {
      poster_code: string;
      poster_title: string;
      judge_name: string;
      comment: string | null;
      submitted_at: string | null;
      scores: Record<string, number> | null;
    };

    // One join instead of PostgREST's embedded-resource syntax. The per-criterion
    // values come back as a single jsonb object so the row order below stays stable.
    const rows = await query<RawRow>(
      `select p.code  as poster_code,
              p.title as poster_title,
              j.name  as judge_name,
              s.comment,
              s.submitted_at,
              (select jsonb_object_agg(ss.criterion_id, ss.value)
                 from submission_scores ss
                where ss.submission_id = s.id) as scores
         from submissions s
         join posters p on p.id = s.poster_id
         join judges  j on j.id = s.judge_id
        where s.event_id = $1
          and s.status = 'submitted'
        order by p.code, j.name`,
      [event.id],
    );

    const body = toCsv(
      [
        "poster_code",
        "poster_title",
        "judge",
        ...criteria.map((c) => `${c.label} (/${c.max_score}, w${c.weight})`),
        "comment",
        "submitted_at",
      ],
      rows.map((row) => {
        const scores = row.scores ?? {};
        return [
          row.poster_code,
          row.poster_title,
          row.judge_name,
          ...criteria.map((c) => scores[c.id] ?? ""),
          row.comment ?? "",
          row.submitted_at ?? "",
        ];
      }),
    );

    return csvResponse(`${event.slug}-raw-scores-${stamp}.csv`, body);
  }

  const results = await getResults(event.id, "raw");

  const body = toCsv(
    ["rank", "poster_code", "title", "location", "weighted_avg_pct", "normalized_z", "judges", "below_target"],
    results.map((row) => [
      row.raw_pct === null ? "" : row.rank,
      row.code,
      row.title,
      row.location ?? "",
      row.raw_pct === null ? "" : Number(row.raw_pct).toFixed(2),
      row.norm_z === null ? "" : Number(row.norm_z).toFixed(3),
      row.n_judges,
      row.n_judges < event.target_judges_per_poster ? "yes" : "",
    ]),
  );

  return csvResponse(`${event.slug}-results-${stamp}.csv`, body);
}

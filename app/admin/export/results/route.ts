import { getAdmin } from "@/lib/auth/admin";
import { csvResponse, toCsv } from "@/lib/csv";
import { db } from "@/lib/supabase/admin";
import {
  getCriteria,
  getPrimaryEvent,
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

  const event = await getPrimaryEvent();
  if (!event) return new Response("No event", { status: 404 });

  const type = new URL(request.url).searchParams.get("type");
  const stamp = new Date().toISOString().slice(0, 10);

  if (type === "raw") {
    const criteria = await getCriteria(event.id);

    const { data: rows } = await db()
      .from("submissions")
      .select(
        "poster_id, submitted_at, comment, judges(name), posters(code, title), submission_scores(criterion_id, value)",
      )
      .eq("event_id", event.id)
      .eq("status", "submitted");

    const body = toCsv(
      [
        "poster_code",
        "poster_title",
        "judge",
        ...criteria.map((c) => `${c.label} (/${c.max_score}, w${c.weight})`),
        "comment",
        "submitted_at",
      ],
      (rows ?? []).map((row) => {
        const one = <T,>(v: T | T[] | null): T | null =>
          Array.isArray(v) ? (v[0] ?? null) : v;
        const poster = one(row.posters) as { code: string; title: string } | null;
        const judge = one(row.judges) as { name: string } | null;

        const scores = new Map(
          (row.submission_scores ?? []).map(
            (s: { criterion_id: string; value: number }) =>
              [s.criterion_id, s.value] as const,
          ),
        );

        return [
          poster?.code ?? "",
          poster?.title ?? "",
          judge?.name ?? "",
          ...criteria.map((c) => scores.get(c.id) ?? ""),
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

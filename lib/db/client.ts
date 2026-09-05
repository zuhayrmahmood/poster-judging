import { Pool, type PoolClient } from "pg";

/**
 * The database connection.
 *
 * Supabase Postgres, reached over a plain connection string rather than through
 * PostgREST. Every read and write in this app is hand-written SQL (see lib/data/*.ts),
 * so the JS client would only have been a second dialect to translate into and out of.
 *
 * Two things about `DATABASE_URL` that are easy to get wrong and expensive to discover
 * on event day:
 *
 *   * **Use the transaction pooler (port 6543), not the direct connection (5432).**
 *     Each serverless instance opens its own pool, and a hall of judges hitting cold
 *     starts will exhaust a direct connection limit long before it troubles the pooler.
 *   * **No prepared statements.** Transaction-mode pooling hands each statement to
 *     whichever backend is free, so a statement prepared on one is missing on the next.
 *     `pg` only prepares when a query is given a `name`, and nothing here does — keep
 *     it that way.
 *
 * Deliberately *not* `server-only`: scripts/seed.ts and scripts/migrate.ts are plain
 * Node scripts and `server-only` throws outside a react-server context. Application
 * code should import `@/lib/db` instead, which adds that guard — same split, and for
 * the same reason, as lib/auth/codes.ts.
 */

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "Missing DATABASE_URL. Copy .env.example to .env.local and paste the " +
          "Supabase connection pooler URI (Project Settings -> Database).",
      );
    }

    pool = new Pool({
      connectionString,
      // Small on purpose. The work per request is a handful of short queries, and many
      // small pools across serverless instances add up faster than one large one.
      max: 5,
      // Return connections to the pooler quickly; instances are short-lived.
      idleTimeoutMillis: 10_000,
      // Fail fast rather than hanging a judge's submit on a network problem.
      connectionTimeoutMillis: 10_000,
    });

    // A backend killed by the pooler or by a Supabase restart surfaces as an error on
    // an idle client. Without a listener, `pg` promotes that to an uncaught exception
    // and takes the whole server process down with it.
    pool.on("error", (error) => {
      console.error("Idle database client error:", error);
    });
  }
  return pool;
}

/** Rows from a parameterized query. Always use `$1` placeholders, never interpolation. */
export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await getPool().query(sql, params);
  return result.rows as T[];
}

/** First row, or null. The query should constrain itself to one row. */
export async function one<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Runs `fn` in a transaction, rolling back if it throws.
 *
 * Takes a dedicated client for the duration: pooled queries are handed out per
 * statement, so a BEGIN issued through the pool would not necessarily reach the same
 * backend as the statements after it.
 */
export async function transaction<T>(
  fn: (tx: {
    query<R>(sql: string, params?: unknown[]): Promise<R[]>;
  }) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await getPool().connect();

  try {
    await client.query("begin");
    const result = await fn({
      async query<R>(sql: string, params: unknown[] = []): Promise<R[]> {
        const rows = await client.query(sql, params);
        return rows.rows as R[];
      },
    });
    await client.query("commit");
    return result;
  } catch (error) {
    // Best-effort: if the connection itself is what failed, the rollback fails too and
    // the original error is the one worth reporting.
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Closes the pool. Only for scripts — the server keeps its pool for its whole life. */
export async function closePool(): Promise<void> {
  if (pool) {
    const closing = pool;
    pool = null;
    await closing.end();
  }
}

/**
 * Postgres sends `numeric` as a string to avoid silent float rounding, so every numeric
 * column has to be coerced before it reaches code that does arithmetic or sorting.
 * Getting this wrong is quiet and nasty: string ordering would rank "9.5" above "81.33".
 */
export function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/** Same, for columns the schema declares `not null`. */
export function numOr(value: unknown, fallback = 0): number {
  return num(value) ?? fallback;
}

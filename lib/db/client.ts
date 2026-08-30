import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

/**
 * The embedded database.
 *
 * PGlite is Postgres compiled to WASM, running inside this process against a directory
 * on disk. It replaces the hosted Supabase project: there is no network, no anon key
 * and no PostgREST surface, which is why db/migrations/0001_init.sql no longer carries
 * the RLS lockdown that guarded those.
 *
 * **PGlite is single-connection.** Exactly one process may hold the data directory, so
 * the Next.js server owns it and Electron's main process never opens it directly. A
 * second opener (a stray `npm run seed` against a running app) will fail rather than
 * corrupt anything, which is the failure mode we want.
 *
 * Deliberately *not* `server-only`: scripts/seed.ts is a plain Node script and
 * `server-only` throws outside a react-server context. Application code should import
 * `@/lib/db` instead, which adds that guard — same split, and for the same reason, as
 * lib/auth/codes.ts.
 */

const MIGRATIONS_TABLE = `
  create table if not exists schema_migrations (
    name       text primary key,
    applied_at timestamptz not null default now()
  )
`;

function dataDir(): string {
  // Electron sets this to <userData>/pgdata. In dev it falls back to a gitignored
  // directory in the repo, so `npm run dev` needs no configuration at all.
  return process.env.PJ_DATA_DIR ?? path.join(process.cwd(), ".pgdata");
}

function migrationsDir(): string {
  // Overridden in the packaged app, where db/ is copied next to the standalone server.
  return (
    process.env.PJ_MIGRATIONS_DIR ?? path.join(process.cwd(), "db", "migrations")
  );
}

/**
 * Applies any migration not yet recorded, in filename order.
 *
 * This replaces pasting SQL into the Supabase editor by hand — a desktop app cannot ask
 * the organiser to do that. Each file runs inside a transaction with its bookkeeping
 * row, so a failure part-way leaves the database on the previous migration rather than
 * half-way through this one.
 */
async function migrate(db: PGlite): Promise<void> {
  await db.exec(MIGRATIONS_TABLE);

  const applied = new Set(
    (
      await db.query<{ name: string }>("select name from schema_migrations")
    ).rows.map((row) => row.name),
  );

  const dir = migrationsDir();
  const pending = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .filter((file) => !applied.has(file));

  for (const file of pending) {
    const sql = readFileSync(path.join(dir, file), "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into schema_migrations (name) values ($1)", [file]);
    });
  }
}

let instance: Promise<PGlite> | null = null;

/**
 * The process-wide database handle, migrated and ready.
 *
 * Cached as the *promise* rather than the resolved client so that concurrent first
 * callers — which is exactly what happens when several judges hit a cold server at once
 * — share one boot and one migration run instead of racing.
 */
export function getDb(): Promise<PGlite> {
  if (!instance) {
    instance = (async () => {
      const db = new PGlite(dataDir());
      await db.waitReady;
      await migrate(db);
      return db;
    })().catch((error) => {
      // Do not cache a failed boot: a bad migration should be retryable after a fix
      // without restarting the whole app.
      instance = null;
      throw error;
    });
  }
  return instance;
}

/** Rows from a parameterized query. Always use `$1` placeholders, never interpolation. */
export async function query<T>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const db = await getDb();
  const { rows } = await db.query<T>(sql, params);
  return rows;
}

/** First row, or null. The query should constrain itself to one row. */
export async function one<T>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Runs `fn` in a transaction, rolling back if it throws. */
export async function transaction<T>(
  fn: (tx: {
    query<R>(sql: string, params?: unknown[]): Promise<R[]>;
  }) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    return fn({
      async query<R>(sql: string, params: unknown[] = []): Promise<R[]> {
        const { rows } = await tx.query<R>(sql, params);
        return rows;
      },
    });
  });
  return result as T;
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

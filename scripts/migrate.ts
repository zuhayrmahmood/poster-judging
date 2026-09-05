/**
 * Applies any migration that has not been applied yet, in filename order.
 *
 *   npm run migrate
 *
 * Reads DATABASE_URL the same way the app does. Point it at the *direct* connection
 * (port 5432) rather than the transaction pooler for this one job: DDL in a single
 * transaction is exactly what transaction-mode pooling is bad at.
 *
 * Each file runs inside a transaction together with its bookkeeping row, so a failure
 * part-way leaves the database on the previous migration rather than half-way through
 * this one. Re-running is a no-op.
 *
 * A database that predates this runner has the schema but no bookkeeping, so migrate
 * would try to create tables that already exist. Baseline it once:
 *
 *   npm run migrate -- --baseline 0004_supabase_auth.sql
 *
 * That records every file up to and including that one as applied *without running
 * them*, and leaves anything after it to apply normally. Check that the named file
 * really does describe the schema you already have before using it.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { closePool, query, transaction } from "@/lib/db/client";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

/** `--baseline <file>`, if present. */
function baselineArg(): string | null {
  const index = process.argv.indexOf("--baseline");
  if (index === -1) return null;

  const value = process.argv[index + 1];
  if (!value) throw new Error("--baseline needs a migration filename.");
  if (!migrationFiles().includes(value)) {
    throw new Error(`No such migration: ${value}`);
  }
  return value;
}

async function main() {
  await query(`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await query<{ name: string }>("select name from schema_migrations")).map(
      (row) => row.name,
    ),
  );

  const baseline = baselineArg();
  if (baseline) {
    const already = migrationFiles().filter(
      (file) => file <= baseline && !applied.has(file),
    );
    for (const file of already) {
      await query("insert into schema_migrations (name) values ($1)", [file]);
      console.log(`Baselined ${file} (recorded, not run)`);
    }
    already.forEach((file) => applied.add(file));
  }

  const pending = migrationFiles().filter((file) => !applied.has(file));

  if (pending.length === 0) {
    console.log("Up to date.");
    return;
  }

  for (const file of pending) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    await transaction(async (tx) => {
      await tx.query(sql);
      await tx.query("insert into schema_migrations (name) values ($1)", [file]);
    });
    console.log(`Applied ${file}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closePool);

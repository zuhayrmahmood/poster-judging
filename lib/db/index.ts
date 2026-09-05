import "server-only";

/**
 * Server-side entry point to the database.
 *
 * The `server-only` import above makes bundling the connection pool — and with it the
 * database credentials — into a client component a build error rather than a leak.
 * Standalone Node scripts import `@/lib/db/client` directly, which is the same module
 * without the guard.
 */
export { closePool, getPool, num, numOr, one, query, transaction } from "./client";

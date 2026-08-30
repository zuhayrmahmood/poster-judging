import "server-only";

/**
 * Server-side entry point to the embedded database.
 *
 * The `server-only` import above makes bundling the database into a client component a
 * build error rather than a 60MB WASM payload shipped to a judge's phone. Standalone
 * Node scripts import `@/lib/db/client` directly, which is the same module without the
 * guard.
 */
export { getDb, num, numOr, one, query, transaction } from "./client";

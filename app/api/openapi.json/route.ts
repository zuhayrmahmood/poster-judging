import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The API's own description, served from the checked-in `openapi.json`.
 *
 * Read at request time rather than imported, so the spec stays a plain artifact that
 * tooling can lint and diff without going through the bundler. `tests/openapi.test.ts`
 * asserts it covers every exported handler, so the two cannot drift.
 *
 * Public: it documents shapes, not data, and every endpoint it describes still requires
 * a session.
 */
export async function GET() {
  const spec = await readFile(join(process.cwd(), "openapi.json"), "utf8");

  return new Response(spec, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}

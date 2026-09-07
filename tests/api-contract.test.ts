import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Contract guards for the HTTP layer.
 *
 * Two regressions are worth spending a test on, and neither is caught by types:
 *
 *   1. A handler that queries the database directly instead of going through a service.
 *      That would be a second authorization path, and a second place for a tenancy check
 *      to go missing — the exact bug class the service layer exists to prevent.
 *   2. A mutating handler that skips the same-origin guard. Server Actions get CSRF
 *      protection from Next automatically; Route Handlers get none, so it is enforced by
 *      hand and therefore forgettable.
 *
 * Plus a coverage check, so the published spec cannot quietly fall behind the routes.
 */

const API_DIR = "app/api";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Handlers that legitimately reach no tenant data. Keep short; justify every entry. */
const NO_SERVICE_NEEDED = new Set([
  // Serves the checked-in spec file. Touches no database and no session.
  "app/api/openapi.json/route.ts GET",
  // Reads the judge's own assignment list, scoped by the judgeId in their signed token.
  "app/api/judge/assignments/route.ts GET",
]);

type Handler = { file: string; method: string; body: string; key: string };

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

function handlers(): Handler[] {
  const found: Handler[] = [];

  for (const file of routeFiles(API_DIR)) {
    const source = readFileSync(file, "utf8");
    const starts: { method: string; index: number }[] = [];

    for (const match of source.matchAll(
      /export async function (GET|POST|PUT|PATCH|DELETE)\s*\(/g,
    )) {
      starts.push({ method: match[1], index: match.index });
    }

    starts.forEach((start, i) => {
      found.push({
        file,
        method: start.method,
        body: source.slice(start.index, starts[i + 1]?.index ?? source.length),
        key: `${file} ${start.method}`,
      });
    });
  }

  return found;
}

const ALL = handlers();

describe("route handlers are transport only", () => {
  it("finds handlers at all, so a refactor cannot silently empty this suite", () => {
    assert.ok(ALL.length >= 20, `expected 20+ handlers, found ${ALL.length}`);
  });

  for (const handler of ALL) {
    if (NO_SERVICE_NEEDED.has(handler.key)) continue;

    it(`${handler.key} goes through a service`, () => {
      assert.match(
        handler.body,
        /\b(events|posters|judges|criteria|assignments|results|submissions)\.\w+\(/,
        `${handler.key} must call lib/services/* rather than deciding authorization itself`,
      );
    });
  }

  for (const handler of ALL) {
    it(`${handler.key} does not query the database directly`, () => {
      assert.doesNotMatch(
        handler.body,
        /\b(query|one|transaction)\s*(<[^>]*>)?\s*\(/,
        `${handler.key} reaches the database directly; ownership checks belong in a service`,
      );
    });
  }

  for (const handler of ALL.filter((h) => MUTATING.has(h.method))) {
    it(`${handler.key} calls requireSameOrigin`, () => {
      assert.match(
        handler.body,
        /requireSameOrigin\(/,
        `${handler.key} mutates state without the CSRF guard. Next protects Server ` +
          `Actions automatically but not Route Handlers, so a cookie-authenticated ` +
          `${handler.method} here is reachable from any page the organiser has open`,
      );
    });
  }

  it("no handler answers 403 for a missing or foreign resource", () => {
    for (const handler of ALL) {
      assert.doesNotMatch(
        handler.body,
        /403[^\n]*not found|not found[^\n]*403/i,
        `${handler.key}: cross-tenant access must be 404, or the id space becomes an ` +
          `oracle for other organisers' resources`,
      );
    }
  });
});

describe("openapi.json covers the implemented surface", () => {
  const spec = JSON.parse(readFileSync("openapi.json", "utf8")) as {
    paths: Record<string, Record<string, unknown>>;
  };

  /** `app/api/events/[eventId]/posters/route.ts` -> `/events/{eventId}/posters` */
  function specPath(file: string): string {
    return (
      "/" +
      file
        .replace(`${API_DIR}/`, "")
        .replace(/\/route\.ts$/, "")
        .replace(/\[([^\]]+)\]/g, "{$1}")
    );
  }

  for (const handler of ALL) {
    if (handler.file.includes("openapi.json")) continue;

    it(`${handler.method} ${specPath(handler.file)} is documented`, () => {
      const entry = spec.paths[specPath(handler.file)];
      assert.ok(entry, `openapi.json has no path ${specPath(handler.file)}`);
      assert.ok(
        entry[handler.method.toLowerCase()],
        `openapi.json documents ${specPath(handler.file)} but not ${handler.method}`,
      );
    });
  }

  it("documents no path that is not implemented", () => {
    const implemented = new Set(
      ALL.filter((h) => !h.file.includes("openapi.json")).map(
        (h) => `${h.method.toLowerCase()} ${specPath(h.file)}`,
      ),
    );

    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const method of Object.keys(methods)) {
        assert.ok(
          implemented.has(`${method} ${path}`),
          `openapi.json documents ${method.toUpperCase()} ${path}, which no route implements`,
        );
      }
    }
  });

  it("every operation declares 401 and 404", () => {
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const responses = (op as { responses: Record<string, unknown> }).responses;
        assert.ok(responses["401"], `${method} ${path} does not document 401`);
        assert.ok(responses["404"], `${method} ${path} does not document 404`);
      }
    }
  });

  it("every mutating operation documents the same-origin refusal", () => {
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        if (!MUTATING.has(method.toUpperCase())) continue;
        const responses = (op as { responses: Record<string, unknown> }).responses;
        assert.ok(
          responses["403"],
          `${method} ${path} mutates but does not document the 403 from requireSameOrigin`,
        );
      }
    }
  });
});

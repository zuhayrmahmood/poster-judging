import { z } from "zod";

import { failure } from "./respond";

/**
 * Request body schemas.
 *
 * Validation at the transport edge is about *shape* — is this JSON, does it have the
 * fields, are they the right types. Domain rules (a weight must be positive, a max
 * score is between 2 and 100) stay in the services, because the Server Action transport
 * has to enforce them too and neither transport should be the only place they exist.
 *
 * Zod is a dependency at this boundary only. `lib/scoring.ts`, `lib/assign.ts` and
 * `lib/auth/codes.ts` stay dependency-free, which is what lets the test suite import
 * them anywhere.
 */

export const eventCreateSchema = z.object({
  name: z.string().min(1),
});

export const eventPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    status: z.enum(["draft", "active", "locked"]).optional(),
    target_judges_per_poster: z.number().int().optional(),
  })
  // A PATCH with no recognised field is a caller mistake, not a no-op success.
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one of name, status, target_judges_per_poster.",
  });

export const orgPatchSchema = z.object({
  name: z.string().min(1),
});

export const posterCreateSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  // Accepts an array, which is the natural JSON shape, and normalises to the
  // semicolon-joined string the service already takes.
  presenter_names: z.array(z.string()).optional(),
  location: z.string().optional(),
});

export const judgeCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
});

export const judgePatchSchema = z
  .object({
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one of: active.",
  });

export const criterionSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
  weight: z.number(),
  max_score: z.number(),
});

export const submissionSchema = z.object({
  status: z.enum(["draft", "submitted"]),
  comment: z.string().optional(),
  // criterion id -> raw value. save_submission clamps values and drops criteria that
  // do not belong to the event, so this only has to establish the shape.
  scores: z.record(z.string(), z.number()),
});

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: Response };

/**
 * Parse and validate a JSON request body.
 *
 * Malformed JSON is a 400 (the request itself is broken); well-formed JSON that fails
 * the schema is a 422 (the request parsed, the content is unacceptable).
 */
export async function parseJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<ParsedBody<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: failure("bad_request", "Expected a JSON body.", 400),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join(".");
    return {
      ok: false,
      response: failure(
        "invalid",
        path ? `${path}: ${first.message}` : (first?.message ?? "Invalid body."),
        422,
      ),
    };
  }

  return { ok: true, data: result.data };
}

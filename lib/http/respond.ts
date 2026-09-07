import type { ServiceError, ServiceResult } from "@/lib/services/result";

/**
 * The wire format, in one place.
 *
 * Route Handlers are transport adapters: they translate a `ServiceResult` into a status
 * code and a JSON body, and decide nothing else. Keeping the mapping here rather than
 * in each handler is what stops one endpoint from answering 403 where its neighbour
 * answers 404 — which for this API is not a cosmetic difference (see below).
 */

/**
 * `not_found` maps to 404 and **never 403**.
 *
 * A 403 says "this exists but is not yours", which is exactly the fact an attacker with
 * a guessed UUID wants confirmed. Services already collapse "no such row" and "not
 * yours" into one value; this table is the other half of that promise.
 */
const STATUS: Record<ServiceError, number> = {
  unauthenticated: 401,
  not_found: 404,
  invalid: 422,
  conflict: 409,
};

export type ErrorCode = ServiceError | "forbidden_origin" | "bad_request";

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Success with a body. */
export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    ...init,
    headers: { ...JSON_HEADERS, ...init?.headers },
  });
}

/**
 * A response carrying a secret — a plaintext judge code — must not be stored by a
 * proxy, a CDN, or the browser's back/forward cache.
 */
export function jsonNoStore(data: unknown, init?: ResponseInit): Response {
  return json(data, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}

/**
 * A collection, always wrapped. The envelope costs nothing today and means cursor
 * pagination can be added later without breaking every client.
 */
export function collection<T>(items: T[], next: string | null = null): Response {
  return json({ data: items, next });
}

/** 201 with a Location header, per the create half of the REST contract. */
export function created(data: unknown, location: string): Response {
  return json(data, { status: 201, headers: { Location: location } });
}

/** 204, for a delete that leaves nothing to say. */
export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function failure(
  code: ErrorCode,
  message: string,
  status: number,
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: JSON_HEADERS,
  });
}

/** The generic denial. Deliberately identical whatever the real reason. */
export function notFound(): Response {
  return failure("not_found", "Not found.", 404);
}

export function unauthenticated(): Response {
  return failure("unauthenticated", "Sign in first.", 401);
}

/**
 * Turn a service failure into a response. Callers handle the success case themselves,
 * because only they know whether it is a 200, a 201 with a Location, or a 204.
 */
export function fromFailure(
  result: Extract<ServiceResult<unknown>, { ok: false }>,
): Response {
  return failure(result.code, result.message, STATUS[result.code]);
}

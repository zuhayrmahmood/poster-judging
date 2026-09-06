/**
 * The contract every service function returns.
 *
 * Services own authorization, validation and SQL. They deliberately do *not* touch
 * cookies, `redirect()` or `revalidatePath()` — those belong to whichever transport is
 * calling. A Server Action turns a failure into `{ error }` for the existing UI
 * convention; a Route Handler turns the same failure into a status code. Keeping the
 * decision in one place is what stops the two paths from drifting into two different
 * answers about who may do what.
 *
 * Pure module: no `server-only`, no imports.
 */

export type ServiceError =
  /** No usable session. */
  | "unauthenticated"
  /**
   * No such row, **or** it belongs to someone else. Those two are deliberately the
   * same value: reporting them differently would let a caller confirm which event and
   * poster ids exist by watching which error comes back.
   */
  | "not_found"
  /** Input failed validation. */
  | "invalid"
  /** Valid input, but the current state forbids it — judging closed, duplicate slug. */
  | "conflict";

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ServiceError; message: string };

/** Whoever is asking. Services never resolve this themselves — it is passed in. */
export type Actor = { id: string };

export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(
  code: ServiceError,
  message: string,
): ServiceResult<T> {
  return { ok: false, code, message };
}

/** The message shown whenever a row is missing or out of the caller's reach. */
export const NOT_FOUND_MESSAGE = "Not found.";

export function notFound<T = never>(): ServiceResult<T> {
  return fail("not_found", NOT_FOUND_MESSAGE);
}

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Access-code primitives.
 *
 * Deliberately a *pure* module: no `server-only`, no env access. The pepper is passed
 * in by the caller. That keeps these functions unit-testable and importable from
 * standalone Node scripts (scripts/seed.ts) — `server-only` resolves to a module that
 * throws outside a react-server context, which would break both. The secrets stay
 * guarded where they actually live, in lib/env.ts and lib/db/index.ts.
 */

/**
 * Crockford base32 minus `0` and `1`. Crockford already drops I, L, O and U; removing
 * the two remaining digit/letter lookalikes leaves an alphabet where no two characters
 * are confusable on a printed card read in a noisy hall.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 8;

/** Largest multiple of the alphabet size that fits in a byte, for rejection sampling. */
const REJECT_ABOVE = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

/**
 * A fresh access code, ~39 bits of entropy (30^8).
 *
 * Uses rejection sampling rather than `byte % 30`, which would make the first 16
 * characters of the alphabet fractionally more likely than the rest.
 */
export function generateCode(): string {
  let code = "";
  while (code.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      if (byte >= REJECT_ABOVE) continue;
      code += ALPHABET[byte % ALPHABET.length];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return code;
}

/**
 * Canonical form of whatever the judge typed: uppercased, with dashes, spaces and any
 * other separator removed. Returns null if the result is not a well-formed code, so a
 * malformed entry never reaches the database.
 */
export function normalizeCode(input: string): string | null {
  const stripped = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (stripped.length !== CODE_LENGTH) return null;
  for (const char of stripped) {
    if (!ALPHABET.includes(char)) return null;
  }
  return stripped;
}

/** `K7M2Q9XR` -> `K7M2-Q9XR`, for printed cards and the reveal-once admin screen. */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Peppered SHA-256 of a normalized code.
 *
 * A fast hash is the right choice here, not a deliberate slowdown like bcrypt: the code
 * is uniformly random with no dictionary to attack, and an indexed hash column gives an
 * O(1) lookup instead of forcing a scan-and-compare over every judge row. Online
 * guessing is handled by the rate limiter in lib/auth/rate-limit.ts.
 */
export function hashCode(normalizedCode: string, pepper: string): string {
  return createHash("sha256").update(pepper).update(normalizedCode).digest("hex");
}

/** Last four characters, shown to admins so they can tell two codes apart at a glance. */
export function codeHint(code: string): string {
  return code.slice(-4);
}

/** Constant-time comparison of two hex hashes. */
export function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

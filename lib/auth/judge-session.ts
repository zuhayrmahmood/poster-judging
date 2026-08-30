import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";

/**
 * Judge sessions are a signed JWT in an httpOnly cookie, deliberately separate from
 * Supabase Auth (which this app uses only for admins). Judges authenticate with a short
 * access code and never have an email/password identity.
 *
 * Everything in this module is edge-safe — `middleware.ts` imports `verifyJudgeToken`,
 * so it must not pull in `node:crypto`. Code hashing lives in ./codes.ts for that reason.
 */

export const JUDGE_COOKIE = "pj_judge";

/** One long event day, plus enough slack for a session started the night before. */
const SESSION_TTL_SECONDS = 24 * 60 * 60;

export type JudgeSession = {
  judgeId: string;
  eventId: string;
};

function secretKey(): Uint8Array {
  const secret = process.env.JUDGE_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "Missing environment variable JUDGE_SESSION_SECRET. Copy .env.example to .env.local and fill it in.",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signJudgeToken(session: JudgeSession): Promise<string> {
  return new SignJWT({ eid: session.eventId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.judgeId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

/** Returns null for any invalid, expired or malformed token. Never throws. */
export async function verifyJudgeToken(
  token: string | undefined,
): Promise<JudgeSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
    });
    const judgeId = payload.sub;
    const eventId = payload.eid;
    if (typeof judgeId !== "string" || typeof eventId !== "string") return null;
    return { judgeId, eventId };
  } catch {
    return null;
  }
}

/** Reads the session in a server component or server action. */
export async function getJudgeSession(): Promise<JudgeSession | null> {
  const store = await cookies();
  return verifyJudgeToken(store.get(JUDGE_COOKIE)?.value);
}

export async function setJudgeCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(JUDGE_COOKIE, token, {
    httpOnly: true,
    // Always false: the app is served over plain HTTP on the venue LAN, never HTTPS.
    // Keying this off NODE_ENV (as the Vercel build did) would make every phone in a
    // packaged build silently discard the cookie, so no judge could stay signed in.
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearJudgeCookie(): Promise<void> {
  const store = await cookies();
  store.delete(JUDGE_COOKIE);
}

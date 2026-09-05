import "server-only";

/**
 * Reads a required environment variable, failing loudly at first use rather than
 * letting an empty string reach the database and surface as a confusing error later.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  /** Signs the judge session cookie. */
  get judgeSessionSecret() {
    return required("JUDGE_SESSION_SECRET");
  },
  /** Mixed into every access-code hash. Changing it invalidates every issued code. */
  get judgeCodePepper() {
    return required("JUDGE_CODE_PEPPER");
  },
};

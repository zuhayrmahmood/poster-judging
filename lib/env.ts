import "server-only";

/**
 * Reads a required environment variable, failing loudly at first use rather than
 * letting an empty string reach the database and surface as a confusing error later.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. The Electron shell sets this at launch; ` +
        `for a bare "npm run dev", copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const env = {
  get judgeSessionSecret() {
    return required("JUDGE_SESSION_SECRET");
  },
  get judgeCodePepper() {
    return required("JUDGE_CODE_PEPPER");
  },
};

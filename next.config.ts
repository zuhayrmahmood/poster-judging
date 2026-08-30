import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The app ships inside Electron rather than deploying to Vercel, so the build has to
   * produce something runnable on its own. `standalone` emits `.next/standalone/server.js`
   * plus only the node_modules it actually needs; electron/main.js spawns exactly that.
   */
  output: "standalone",

  /**
   * PGlite must be require()d from node_modules at runtime, never bundled.
   *
   * It locates its WASM and data files with `new URL(..., import.meta.url)` and hands
   * the result to `fs`. Bundled into the server-component graph, those URL instances
   * come from a different module realm, so `instanceof URL` fails inside Node and every
   * page that touches the database dies with "path argument must be of type string or
   * an instance of Buffer or URL. Received an instance of URL". Route handlers happened
   * to survive it; layouts and pages did not.
   */
  serverExternalPackages: ["@electric-sql/pglite"],

  outputFileTracingIncludes: {
    /**
     * PGlite loads its WASM and data files from disk at runtime rather than importing
     * them, so Next's static tracing cannot see them and would ship a build that dies
     * on first query. Pull the whole package in explicitly.
     */
    "/**/*": ["./node_modules/@electric-sql/pglite/dist/**/*"],
  },
};

export default nextConfig;

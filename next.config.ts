import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Judges test on their phones over the venue LAN, so `next dev` gets visited at
   * http://<lan-ip>:3000 rather than localhost. Next 16 blocks cross-origin requests
   * to dev-only endpoints (`/_next/*`, `/__nextjs*`) by default, allowing only
   * localhost — which 403s the HMR socket and the error overlay on a LAN address.
   *
   * Page chunks still load (a <script> tag sends no Origin header), so the app does
   * render; what breaks is hot reload and, more importantly, the dev error overlay —
   * so a client-side exception fails silently instead of showing itself.
   *
   * Development only: `next start` ignores this entirely.
   */
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*", "*.local"],
};

export default nextConfig;

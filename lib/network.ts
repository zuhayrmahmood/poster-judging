import "server-only";

import { networkInterfaces } from "node:os";

/**
 * Working out the address judges should type into their phones.
 *
 * The organiser's laptop usually has several addresses — loopback, a VPN tunnel, Docker
 * bridges, sometimes both wifi and ethernet. Only one of them is reachable from a phone
 * on the venue wifi, and picking the wrong one is the most likely way for the whole
 * event to stall before it starts, so the UI lists candidates in best-guess order and
 * lets the organiser choose rather than guessing silently.
 */

export type LanAddress = {
  /** The OS interface name, e.g. `en0`. */
  iface: string;
  address: string;
  url: string;
  /** Ranked best-first; the top one is what the Connect page shows by default. */
  likely: boolean;
};

export function serverPort(): number {
  return Number(process.env.PORT ?? 3000);
}

/**
 * Private-range IPv4 addresses, most-likely-first.
 *
 * 169.254/16 is link-local (a failed DHCP lease) and never useful. Loopback is excluded
 * because a phone cannot reach it — that address is precisely the one an organiser
 * copies by mistake.
 */
export function lanAddresses(): LanAddress[] {
  const port = serverPort();
  const found: LanAddress[] = [];

  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      if (addr.address.startsWith("169.254.")) continue;

      found.push({
        iface,
        address: addr.address,
        url: `http://${addr.address}:${port}`,
        likely: isLikelyVenueWifi(iface, addr.address),
      });
    }
  }

  return found.sort((a, b) => Number(b.likely) - Number(a.likely));
}

/**
 * Heuristic, not a guarantee. Prefers ordinary private ranges on interfaces that look
 * like real wifi/ethernet, and pushes VPN and container bridges down the list.
 */
function isLikelyVenueWifi(iface: string, address: string): boolean {
  const suspicious = /^(utun|tun|tap|ppp|docker|br-|veth|vbox|vmnet|awdl|llw)/i;
  if (suspicious.test(iface)) return false;

  return (
    address.startsWith("192.168.") ||
    address.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address)
  );
}

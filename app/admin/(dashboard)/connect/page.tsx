import QRCode from "qrcode";

import { requireAdmin } from "@/lib/auth/admin";
import { getPrimaryEvent } from "@/lib/data/admin";
import { lanAddresses } from "@/lib/network";

export const dynamic = "force-dynamic";

/**
 * How judges get onto the app.
 *
 * This is the screen that replaces "the URL of the Vercel deployment". The server is on
 * the organiser's laptop now, so its address is whatever the venue wifi handed out this
 * morning — it changes per venue, and nobody can be told it in advance.
 */
export default async function ConnectPage() {
  await requireAdmin();

  const event = await getPrimaryEvent();
  const addresses = lanAddresses();
  const primary = addresses[0];

  const qr = primary
    ? await QRCode.toString(primary.url, {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M",
      })
    : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Connect judges</h1>
        <p className="text-sm text-muted">
          Judges open this address on their own phone, on the same wifi, and sign in with
          their access code.
        </p>
      </header>

      {!primary ? (
        <div className="rounded-xl border border-warning-soft bg-warning-soft px-4 py-6 text-sm text-warning">
          <p className="font-medium">This machine isn&apos;t on a network.</p>
          <p className="mt-1">
            Join the venue wifi (or start a hotspot from your phone and join that), then
            reload this page. Judges must be on the same network.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="flex flex-col gap-3">
            <div
              className="w-56 rounded-xl border border-line bg-white p-3 [&_svg]:h-full [&_svg]:w-full"
              // qrcode emits a self-contained SVG with no scripts or external refs.
              dangerouslySetInnerHTML={{ __html: qr ?? "" }}
            />
            <p className="text-xs text-muted">Point a phone camera at this.</p>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Or type it in
              </p>
              <p className="break-all font-mono text-xl font-semibold">{primary.url}</p>
              <p className="text-xs text-muted">
                on <span className="font-medium">{primary.iface}</span>
              </p>
            </div>

            {event ? (
              <p className="text-sm text-muted">
                {event.status === "active" ? (
                  <>
                    Judging is <span className="font-medium text-success">open</span>.
                  </>
                ) : (
                  <>
                    Judging is{" "}
                    <span className="font-medium text-warning">
                      {event.status === "draft" ? "not open yet" : "closed"}
                    </span>{" "}
                    — judges can sign in but cannot score. Open it in Settings.
                  </>
                )}
              </p>
            ) : (
              <p className="text-sm text-muted">Create an event in Settings first.</p>
            )}

            {addresses.length > 1 ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Other addresses on this machine
                </p>
                <ul className="flex flex-col gap-1">
                  {addresses.slice(1).map((addr) => (
                    <li key={`${addr.iface}-${addr.address}`} className="text-sm">
                      <span className="font-mono">{addr.url}</span>{" "}
                      <span className="text-muted">({addr.iface})</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted">
                  If the address above doesn&apos;t load on a phone, try these — a VPN or
                  virtual adapter can outrank the real wifi.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

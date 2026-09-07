import { requireSameOrigin, resolveAdmin } from "@/lib/http/guards";
import { fromFailure, jsonNoStore, unauthenticated } from "@/lib/http/respond";
import * as judges from "@/lib/services/judges";

/**
 * Fresh codes for every active judge, for the printable card sheet.
 *
 * The one operation here that does not map cleanly onto CRUD. Modelled as creating a
 * new set of codes under a sub-collection, which is the conventional REST answer for an
 * operation whose result is a created resource rather than an updated field.
 *
 * All-or-nothing in one transaction: a partial rotation would commit new hashes for the
 * judges already processed while discarding the only copy of their plaintext, locking
 * them out at exactly the moment the cards are being printed.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const admin = await resolveAdmin();
  if (!admin) return unauthenticated();

  const { eventId } = await params;
  const result = await judges.rotateAllCodes(admin, eventId);
  return result.ok ? jsonNoStore({ cards: result.data.cards }) : fromFailure(result);
}

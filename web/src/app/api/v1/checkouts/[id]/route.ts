import { getCheckout, toCheckout } from "@/server/modules/developer/checkouts";
import {
  apiError,
  authorize,
  publicOrigin,
} from "@/server/modules/developer/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/checkouts/:id: current status of one of the account's checkouts. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  if (!/^[0-9A-Za-z]{8,24}$/.test(id))
    return apiError(404, "not_found", "No such checkout.");
  const invoice = await getCheckout(auth.owner, id);
  if (!invoice) return apiError(404, "not_found", "No such checkout.");
  return Response.json(toCheckout(invoice, publicOrigin(request)));
}

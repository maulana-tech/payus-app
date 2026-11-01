import { toMinor } from "@/features/invoices/money";
import {
  createCheckout,
  toCheckout,
} from "@/server/modules/developer/checkouts";
import { checkoutInput } from "@/server/modules/developer/developer.schema";
import {
  apiError,
  authorize,
  publicOrigin,
} from "@/server/modules/developer/http";

export const dynamic = "force-dynamic";

/** POST /api/v1/checkouts: create a checkout for the API key's account. */
export async function POST(request: Request) {
  const auth = await authorize(request);
  if (auth instanceof Response) return auth;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "invalid_json", "The body must be JSON.");
  }
  const parsed = checkoutInput.safeParse(body);
  if (!parsed.success)
    return apiError(
      400,
      "invalid_request",
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
        .join("; "),
    );
  const input = parsed.data;
  try {
    if (toMinor(input.amount) <= 0n) throw new Error();
  } catch {
    return apiError(
      400,
      "invalid_amount",
      "amount must be positive, with up to 2 decimals.",
    );
  }
  const invoice = await createCheckout(auth.owner, input);
  return Response.json(toCheckout(invoice, publicOrigin(request)), {
    status: 201,
  });
}

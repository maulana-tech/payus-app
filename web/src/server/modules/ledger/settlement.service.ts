import "server-only";
import type { Allocation } from "../../../features/split/evaluate";
import { account } from "./accounts";
import { type Posting, post } from "./ledger.service";
import { accountFor, planSplit } from "./split.service";

// Settlement: money that was taken sits in `in_flight` until the owner's
// rules say where it belongs. One posting moves all of it at once, so the
// account is either entirely settled or untouched.

export type Settlement = {
  settled: boolean;
  allocations: Allocation[];
};

/**
 * Divides one capture according to the owner's rules. The transaction id is
 * derived from the capture, so settling twice is a no-op — and because the
 * whole of `in_flight` for this capture is moved in a single posting, a
 * partial settlement cannot exist.
 */
export async function settleCapture(input: {
  owner: string;
  captureId: string;
  invoiceId: string;
  grossMinor: bigint;
  currency: string;
}): Promise<Settlement> {
  const allocations = await planSplit(input.owner, input.grossMinor);
  if (allocations.length === 0) return { settled: false, allocations };

  const postings: Posting[] = [
    { account: account.inFlight(input.owner), debitMinor: input.grossMinor },
    ...allocations.map((allocation) => ({
      account: accountFor(input.owner, allocation.target),
      creditMinor: allocation.amountMinor,
    })),
  ];

  const { posted } = await post(
    {
      id: `settle:${input.captureId}`,
      kind: "settlement",
      owner: input.owner,
      ref: `invoice:${input.invoiceId}`,
      memo: allocations.map((a) => a.name).join(" · "),
      currency: input.currency,
    },
    postings,
  );
  return { settled: posted, allocations };
}

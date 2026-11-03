// Giving money back. A capture was divided between pots — tax set aside,
// the platform's cut, what is yours — so a refund has to come back out of
// the same pots, in the same proportions. Pure arithmetic in integer minor
// units, with one invariant the tests hold it to: what comes back out adds
// up to exactly what is being refunded.
//
// Why proportional and not "take it all from the merchant": the tax set
// aside on a sale that was undone is not tax. A rolling reserve would be
// the other answer, but it withholds money from every merchant to pay for
// something rare, which is a bigger promise than this needs.

export type Share = { account: string; amountMinor: bigint };

/**
 * Splits `amount` across the shares in proportion to their size, settled
 * with the largest-remainder method so the parts add up exactly.
 */
function allocate(amount: bigint, shares: Share[]): bigint[] {
  const total = shares.reduce((sum, share) => sum + share.amountMinor, 0n);
  if (total <= 0n || amount <= 0n) return shares.map(() => 0n);
  if (amount >= total) return shares.map((share) => share.amountMinor);

  const parts = shares.map((share, index) => ({
    index,
    floor: (amount * share.amountMinor) / total,
    remainder: (amount * share.amountMinor) % total,
  }));
  const given = parts.reduce((sum, part) => sum + part.floor, 0n);
  const out = parts.map((part) => part.floor);

  // The units flooring dropped go to the shares cut by the most.
  const queue = [...parts].sort(
    (a, b) =>
      (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : 0) ||
      a.index - b.index,
  );
  let left = amount - given;
  for (const part of queue) {
    if (left <= 0n) break;
    out[part.index] += 1n;
    left -= 1n;
  }
  return out;
}

/**
 * What to take back from each pot when the total refunded against one
 * capture grows from `refundedBefore` to `refundedTotal`.
 *
 * It is written as the difference between two whole-amount allocations
 * rather than as an allocation of this refund alone: three refunds of a
 * third then add up to the capture exactly, instead of drifting a cent per
 * rounding. Largest-remainder is not strictly monotonic, so a step that
 * comes out negative is clamped and the difference taken from the largest
 * positive one — the books balance either way.
 */
export function reversal(
  shares: Share[],
  refundedBefore: bigint,
  refundedTotal: bigint,
): Share[] {
  if (refundedTotal < refundedBefore)
    throw new Error("A refund total cannot go backwards.");
  const before = allocate(refundedBefore, shares);
  const after = allocate(refundedTotal, shares);
  const step = after.map((value, index) => value - (before[index] ?? 0n));

  let owed = 0n;
  for (let i = 0; i < step.length; i++) {
    if (step[i] < 0n) {
      owed -= step[i];
      step[i] = 0n;
    }
  }
  while (owed > 0n) {
    let biggest = -1;
    for (let i = 0; i < step.length; i++)
      if (step[i] > 0n && (biggest === -1 || step[i] > step[biggest]))
        biggest = i;
    if (biggest === -1) break; // nothing to take it from; caller sees a short sum
    const take = step[biggest] < owed ? step[biggest] : owed;
    step[biggest] -= take;
    owed -= take;
  }

  return shares
    .map((share, index) => ({
      account: share.account,
      amountMinor: step[index] ?? 0n,
    }))
    .filter((share) => share.amountMinor > 0n);
}

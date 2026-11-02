// Dividing money that has arrived. Pure arithmetic in integer minor units:
// no database, no rounding surprises, and one invariant the tests hold it to
// — the allocations always add up to exactly what came in.

export type SplitKind = "percent" | "fixed";

export type SplitRule = {
  id: string;
  name: string;
  /** "tax_reserve", "platform_fee", "merchant_payable", or "pos:<slug>". */
  target: string;
  kind: SplitKind;
  /** Basis points for a percent (2500 = 25%), minor units for a fixed cut. */
  value: bigint;
  /** Lower goes first, and goes first at getting what is left. */
  priority: number;
};

export type Allocation = {
  /** null for the remainder, which belongs to no rule. */
  ruleId: string | null;
  name: string;
  target: string;
  amountMinor: bigint;
};

export const BASIS_POINTS = 10_000n;

/** The order rules are applied in, and the order ties are broken in. */
const byPriority = (a: SplitRule, b: SplitRule) =>
  a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Percentages rarely divide cleanly, so the group is settled with the
 * largest-remainder method: every share is floored, then the units left over
 * go to the shares that were cut by the most. The group therefore adds up to
 * the percentage of the whole, to the cent, with no bias toward the first
 * rule in the list.
 */
function percentShares(
  amountMinor: bigint,
  rules: SplitRule[],
): Map<string, bigint> {
  const shares = new Map<string, bigint>();
  if (rules.length === 0) return shares;

  const totalBp = rules.reduce((sum, rule) => sum + rule.value, 0n);
  const groupTarget = (() => {
    const exact = (amountMinor * totalBp) / BASIS_POINTS;
    return exact > amountMinor ? amountMinor : exact;
  })();

  const parts = rules.map((rule) => ({
    rule,
    floor: (amountMinor * rule.value) / BASIS_POINTS,
    remainder: (amountMinor * rule.value) % BASIS_POINTS,
  }));
  let given = parts.reduce((sum, part) => sum + part.floor, 0n);
  for (const part of parts) shares.set(part.rule.id, part.floor);

  // The units the flooring dropped, handed out to the biggest fractions.
  const queue = [...parts].sort(
    (a, b) =>
      (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : 0) ||
      byPriority(a.rule, b.rule),
  );
  for (const part of queue) {
    if (given >= groupTarget) break;
    shares.set(part.rule.id, (shares.get(part.rule.id) ?? 0n) + 1n);
    given += 1n;
  }
  return shares;
}

/**
 * Divides `amountMinor` between the rules, in priority order, and gives
 * whatever is left to `remainderTarget`. A rule that asks for more than is
 * left gets what is left; nothing is ever created or lost.
 *
 * Percentages are of the whole amount, not of the running remainder, because
 * "25% to tax" is what someone means when they write it down.
 */
export function evaluateSplit(
  amountMinor: bigint,
  rules: SplitRule[],
  remainderTarget = "merchant_payable",
  remainderName = "Yours",
): Allocation[] {
  if (amountMinor < 0n)
    throw new Error("A split divides money that arrived, never a negative.");

  const ordered = [...rules].sort(byPriority);
  const shares = percentShares(
    amountMinor,
    ordered.filter((rule) => rule.kind === "percent"),
  );

  const allocations: Allocation[] = [];
  let left = amountMinor;
  for (const rule of ordered) {
    if (left === 0n) break;
    const wanted =
      rule.kind === "percent" ? (shares.get(rule.id) ?? 0n) : rule.value;
    const given = wanted > left ? left : wanted;
    if (given <= 0n) continue;
    allocations.push({
      ruleId: rule.id,
      name: rule.name,
      target: rule.target,
      amountMinor: given,
    });
    left -= given;
  }

  if (left > 0n)
    allocations.push({
      ruleId: null,
      name: remainderName,
      target: remainderTarget,
      amountMinor: left,
    });
  return allocations;
}

/** What a rule would take out of `amountMinor`, for a preview. */
export function previewSplit(amountMinor: bigint, rules: SplitRule[]) {
  const allocations = evaluateSplit(amountMinor, rules);
  return {
    allocations,
    total: allocations.reduce((sum, a) => sum + a.amountMinor, 0n),
  };
}

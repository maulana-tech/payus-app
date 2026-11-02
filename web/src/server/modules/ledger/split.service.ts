import "server-only";
import { and, asc, eq } from "drizzle-orm";
import {
  type Allocation,
  evaluateSplit,
  type SplitRule,
} from "../../../features/split/evaluate";
import { newId } from "../../../lib/ids";
import { getDb, splitRules } from "../../db/client";
import { account } from "./accounts";

// An owner's rules, and the accounts they name. The arithmetic lives in
// `features/split`; this module only reads rules and resolves targets.

export type { Allocation, SplitRule };

export type RuleInput = {
  name: string;
  target: string;
  kind: "percent" | "fixed";
  value: string;
  /** Defaults to the position in the list it arrived in. */
  priority?: number;
};

const toRule = (row: {
  id: string;
  name: string;
  target: string;
  kind: "percent" | "fixed";
  value: string;
  priority: number;
}): SplitRule => ({
  id: row.id,
  name: row.name,
  target: row.target,
  kind: row.kind,
  value: BigInt(row.value),
  priority: row.priority,
});

export async function activeRules(owner: string): Promise<SplitRule[]> {
  const rows = await getDb()
    .select()
    .from(splitRules)
    .where(and(eq(splitRules.owner, owner), eq(splitRules.state, "active")))
    .orderBy(asc(splitRules.priority), asc(splitRules.id));
  return rows.map(toRule);
}

export async function listRules(owner: string) {
  const rows = await getDb()
    .select()
    .from(splitRules)
    .where(eq(splitRules.owner, owner))
    .orderBy(asc(splitRules.priority), asc(splitRules.id));
  return rows.map((row) => ({ ...toRule(row), state: row.state }));
}

export async function createRule(owner: string, input: RuleInput) {
  const [row] = await getDb()
    .insert(splitRules)
    .values({
      id: newId(),
      owner,
      name: input.name,
      target: input.target,
      kind: input.kind,
      value: input.value,
      priority: input.priority ?? 0,
      state: "active",
    })
    .returning();
  return { ...toRule(row), state: row.state };
}

export async function updateRule(
  owner: string,
  id: string,
  input: Partial<RuleInput> & { state?: "active" | "archived" },
) {
  const [row] = await getDb()
    .update(splitRules)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(splitRules.id, id), eq(splitRules.owner, owner)))
    .returning();
  if (!row) throw new Error("No such split rule.");
  return { ...toRule(row), state: row.state };
}

/**
 * Swaps the owner's rules for a new set, in one transaction: the old ones
 * are archived rather than deleted, so a past split can still be read back
 * against the postings it produced.
 */
export async function replaceRules(
  owner: string,
  rules: RuleInput[],
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(splitRules)
      .set({ state: "archived", updatedAt: new Date() })
      .where(and(eq(splitRules.owner, owner), eq(splitRules.state, "active")));
    if (rules.length === 0) return;
    await tx.insert(splitRules).values(
      rules.map((rule, index) => ({
        id: newId(),
        owner,
        name: rule.name,
        target: rule.target,
        kind: rule.kind,
        value: rule.value,
        priority: rule.priority ?? index,
        state: "active" as const,
      })),
    );
  });
}

/** The ledger account a rule's target names for this owner. */
export function accountFor(owner: string, target: string): string {
  if (target === "platform_fee") return account.platformFee();
  if (target === "tax_reserve") return account.taxReserve(owner);
  if (target === "merchant_payable") return account.merchantPayable(owner);
  if (target.startsWith("pos:")) {
    const slug = target.slice(4);
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(slug))
      throw new Error(`"${target}" is not a usable pot name.`);
    return account.pos(owner, slug);
  }
  throw new Error(`"${target}" is not somewhere money can go.`);
}

/** What this owner's rules would do with an amount, without writing it. */
export async function planSplit(
  owner: string,
  amountMinor: bigint,
): Promise<Allocation[]> {
  return evaluateSplit(amountMinor, await activeRules(owner));
}

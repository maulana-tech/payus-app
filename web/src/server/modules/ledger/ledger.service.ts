import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { DEFAULT_CURRENCY } from "../../../features/invoices/money";
import { newId } from "../../../lib/ids";
import {
  getDb,
  ledgerAccounts,
  ledgerEntries,
  ledgerTxns,
} from "../../db/client";
import { labelFor, normalSide, parseAccount } from "./accounts";
import { LedgerPostingError, LedgerUnbalancedError } from "./ledger.errors";

export { account, parseAccount } from "./accounts";

export type Posting = {
  account: string;
  /** Exactly one of the two is given and positive. */
  debitMinor?: bigint;
  creditMinor?: bigint;
  currency?: string;
};

export type Txn = {
  /** Deterministic, e.g. `capture:<captureId>`. It is the idempotency key. */
  id: string;
  kind: string;
  owner?: string | null;
  ref?: string | null;
  memo?: string | null;
  currency?: string;
};

const sum = (values: bigint[]) => values.reduce((a, b) => a + b, 0n);

/**
 * Posts one balanced transaction. Returns `{ posted: false }` when this
 * transaction id was already posted — callers may retry freely.
 *
 * Throws before touching the database when the postings do not balance, so
 * an unbalanced ledger is not representable.
 */
export async function post(
  txn: Txn,
  postings: Posting[],
): Promise<{ posted: boolean }> {
  if (postings.length < 2)
    throw new LedgerPostingError("A transaction needs at least two postings.");
  const currency = txn.currency ?? DEFAULT_CURRENCY;
  for (const p of postings) {
    const debit = p.debitMinor ?? 0n;
    const credit = p.creditMinor ?? 0n;
    if (debit < 0n || credit < 0n)
      throw new LedgerPostingError("Postings are never negative.");
    if (debit > 0n === credit > 0n)
      throw new LedgerPostingError(
        `Posting to ${p.account} must be either a debit or a credit.`,
      );
    parseAccount(p.account); // rejects an unknown account kind
  }
  const debits = sum(postings.map((p) => p.debitMinor ?? 0n));
  const credits = sum(postings.map((p) => p.creditMinor ?? 0n));
  if (debits !== credits) throw new LedgerUnbalancedError(debits, credits);

  return getDb().transaction(async (tx) => {
    // Accounts come into existence on first use; the id already carries
    // everything a row needs.
    for (const id of new Set(postings.map((p) => p.account))) {
      const { kind, owner } = parseAccount(id);
      await tx
        .insert(ledgerAccounts)
        .values({
          id,
          kind,
          owner:
            kind === "platform_fee" || kind === "paypal_cash" ? null : owner,
          label: labelFor(id),
          currency,
        })
        .onConflictDoNothing();
    }
    const [head] = await tx
      .insert(ledgerTxns)
      .values({
        id: txn.id,
        kind: txn.kind,
        owner: txn.owner ?? null,
        ref: txn.ref ?? null,
        memo: txn.memo ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: ledgerTxns.id });
    if (!head) return { posted: false }; // already posted
    await tx.insert(ledgerEntries).values(
      postings.map((p) => ({
        id: newId(),
        txnId: txn.id,
        account: p.account,
        debitMinor: (p.debitMinor ?? 0n).toString(),
        creditMinor: (p.creditMinor ?? 0n).toString(),
        currency: p.currency ?? currency,
      })),
    );
    return { posted: true };
  });
}

/** Debit minus credit, as stored. */
export async function rawBalance(accountId: string): Promise<bigint> {
  const [row] = await getDb()
    .select({
      debit: sql<string>`coalesce(sum(${ledgerEntries.debitMinor}), 0)`,
      credit: sql<string>`coalesce(sum(${ledgerEntries.creditMinor}), 0)`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.account, accountId));
  return BigInt(row?.debit ?? "0") - BigInt(row?.credit ?? "0");
}

/**
 * The balance in the account's normal direction, so a liability we owe and
 * an asset we hold both read as a positive number.
 */
export async function balance(accountId: string): Promise<bigint> {
  const raw = await rawBalance(accountId);
  return normalSide(accountId) === "debit" ? raw : -raw;
}

export type AccountBalance = {
  account: string;
  kind: string;
  owner: string | null;
  label: string;
  /** In the account's normal direction. */
  balanceMinor: string;
  currency: string;
};

/** Every account with a balance, for reconciliation and reports. */
export async function balances(owner?: string): Promise<AccountBalance[]> {
  const rows = await getDb()
    .select({
      account: ledgerAccounts.id,
      kind: ledgerAccounts.kind,
      owner: ledgerAccounts.owner,
      label: ledgerAccounts.label,
      currency: ledgerAccounts.currency,
      debit: sql<string>`coalesce(sum(${ledgerEntries.debitMinor}), 0)`,
      credit: sql<string>`coalesce(sum(${ledgerEntries.creditMinor}), 0)`,
    })
    .from(ledgerAccounts)
    .leftJoin(ledgerEntries, eq(ledgerEntries.account, ledgerAccounts.id))
    .groupBy(
      ledgerAccounts.id,
      ledgerAccounts.kind,
      ledgerAccounts.owner,
      ledgerAccounts.label,
      ledgerAccounts.currency,
    )
    .orderBy(asc(ledgerAccounts.id));
  return rows
    .filter((r) => (owner ? r.owner === owner : true))
    .map((r) => {
      const raw = BigInt(r.debit) - BigInt(r.credit);
      return {
        account: r.account,
        kind: r.kind,
        owner: r.owner,
        label: r.label,
        currency: r.currency,
        balanceMinor: (normalSide(r.account) === "debit"
          ? raw
          : -raw
        ).toString(),
      };
    });
}

/**
 * Σ(debit) − Σ(credit) over the whole ledger. It is 0 in a sound ledger;
 * anything else means a posting bypassed `post()`.
 */
export async function trialBalance(): Promise<bigint> {
  const [row] = await getDb()
    .select({
      debit: sql<string>`coalesce(sum(${ledgerEntries.debitMinor}), 0)`,
      credit: sql<string>`coalesce(sum(${ledgerEntries.creditMinor}), 0)`,
    })
    .from(ledgerEntries);
  return BigInt(row?.debit ?? "0") - BigInt(row?.credit ?? "0");
}

/** The entries of one transaction, for the audit trail. */
export async function entriesOf(txnId: string) {
  return getDb()
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.txnId, txnId))
    .orderBy(asc(ledgerEntries.id));
}

export type LedgerRow = {
  id: string;
  txnId: string;
  kind: string;
  ref: string | null;
  memo: string | null;
  account: string;
  debitMinor: string;
  creditMinor: string;
  currency: string;
  createdAt: string;
};

/**
 * Every entry of this owner's transactions, newest first. Both sides of a
 * transaction are returned — including the platform's own accounts — because
 * a half-shown posting is a misleading one.
 */
export async function entriesFor(
  owner: string,
  limit = 500,
): Promise<LedgerRow[]> {
  const rows = await getDb()
    .select({
      id: ledgerEntries.id,
      txnId: ledgerEntries.txnId,
      kind: ledgerTxns.kind,
      ref: ledgerTxns.ref,
      memo: ledgerTxns.memo,
      account: ledgerEntries.account,
      debitMinor: ledgerEntries.debitMinor,
      creditMinor: ledgerEntries.creditMinor,
      currency: ledgerEntries.currency,
      createdAt: ledgerEntries.createdAt,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerTxns, eq(ledgerTxns.id, ledgerEntries.txnId))
    .where(eq(ledgerTxns.owner, owner))
    .orderBy(desc(ledgerEntries.createdAt), asc(ledgerEntries.id))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
}

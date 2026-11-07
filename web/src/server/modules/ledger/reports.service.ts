import "server-only";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { Posting } from "../../../features/reconcile/match";
import {
  type Entry,
  type SettlementReport,
  settlementReport,
} from "../../../features/reports/settlement";
import { getDb, ledgerEntries, ledgerTxns } from "../../db/client";
import { account } from "./accounts";

// The settlement report: the ledger, grouped by day, for one owner. The
// arithmetic lives in `features/reports/settlement.ts`; this file only
// fetches, so the screen, the CSV and the PDF all read the same numbers.

/** `to` is inclusive: the query runs to the end of that day, in UTC. */
export async function settlementFor(
  owner: string,
  range: { from: string; to: string },
): Promise<SettlementReport> {
  const from = new Date(`${range.from}T00:00:00.000Z`);
  const to = new Date(`${range.to}T00:00:00.000Z`);
  to.setUTCDate(to.getUTCDate() + 1);

  const rows = await getDb()
    .select({
      kind: ledgerTxns.kind,
      account: ledgerEntries.account,
      debitMinor: ledgerEntries.debitMinor,
      creditMinor: ledgerEntries.creditMinor,
      createdAt: ledgerEntries.createdAt,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerTxns, eq(ledgerTxns.id, ledgerEntries.txnId))
    .where(
      and(
        eq(ledgerTxns.owner, owner),
        gte(ledgerEntries.createdAt, from),
        lt(ledgerEntries.createdAt, to),
      ),
    )
    .orderBy(asc(ledgerEntries.createdAt));

  const entries: Entry[] = rows.map((row) => ({
    day: row.createdAt.toISOString().slice(0, 10),
    kind: row.kind,
    account: row.account,
    debitMinor: BigInt(row.debitMinor),
    creditMinor: BigInt(row.creditMinor),
  }));
  return settlementReport(entries, range);
}

/**
 * The cash account's own movements, as a statement would see them.
 *
 * `paypal_cash` is the only account a bank or processor statement can be
 * put against: everything else in these books is a category this app made
 * up, and no outside statement knows about them.
 */
export async function cashPostings(
  owner: string,
  range: { from: string; to: string },
): Promise<Posting[]> {
  const from = new Date(`${range.from}T00:00:00.000Z`);
  const to = new Date(`${range.to}T00:00:00.000Z`);
  to.setUTCDate(to.getUTCDate() + 1);

  const rows = await getDb()
    .select({
      id: ledgerEntries.id,
      kind: ledgerTxns.kind,
      debitMinor: ledgerEntries.debitMinor,
      creditMinor: ledgerEntries.creditMinor,
      createdAt: ledgerEntries.createdAt,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerTxns, eq(ledgerTxns.id, ledgerEntries.txnId))
    .where(
      and(
        eq(ledgerTxns.owner, owner),
        eq(ledgerEntries.account, account.paypalCash()),
        gte(ledgerEntries.createdAt, from),
        lt(ledgerEntries.createdAt, to),
      ),
    )
    .orderBy(asc(ledgerEntries.createdAt));

  // A debit to cash is money arriving, a credit is money leaving — which is
  // the sign a statement shows.
  return rows.map((row) => ({
    id: String(row.id),
    date: row.createdAt.toISOString().slice(0, 10),
    amountMinor: BigInt(row.debitMinor) - BigInt(row.creditMinor),
    description: row.kind,
  }));
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { invoiceStatus } from "@/features/invoices/input";
import { formatMinor } from "@/features/invoices/money";
import { trpc } from "@/trpc/react";
import { dashButtonSecondary } from "../styles";
import { ApprovalsPanel } from "./ApprovalsPanel";
import {
  accountLabel,
  EmptyState,
  Ledger,
  ListRow,
  Money,
  Panel,
  Stat,
  StatusChip,
} from "./kit";
import { ReleaseDialog } from "./ReleaseDialog";
import { SplitRulesPanel } from "./SplitRules";

// Everything on this screen is read from the ledger and the invoices
// themselves. Nothing is cached, averaged or estimated.

export function OverviewScreen({ username }: { username: string }) {
  const summary = trpc.ledger.summary.useQuery();
  const [releasing, setReleasing] = useState(false);
  const data = summary.data;
  const payable = data?.payableMinor ?? "0";

  return (
    <div className="grid gap-4">
      <Ledger className="sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Outstanding"
          value={
            data ? formatMinor(BigInt(data.invoices.outstandingMinor)) : "—"
          }
          foot={`${data?.invoices.pending ?? 0} open invoice${
            data?.invoices.pending === 1 ? "" : "s"
          }`}
        />
        <Stat
          label="Overdue"
          value={data?.invoices.overdue ?? "—"}
          foot={
            data?.invoices.overdue
              ? "Past the due date"
              : "Nothing past its date"
          }
        />
        <Stat
          label="Paid"
          value={data ? formatMinor(BigInt(data.invoices.paidMinor)) : "—"}
          foot="Across every settled invoice"
        />
        <Stat
          label="Owed to you"
          value={data ? formatMinor(BigInt(payable)) : "—"}
          foot="After every split, ready to release"
        />
      </Ledger>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="On the books"
          hint="Balances straight out of the double-entry ledger."
          action={
            <button
              type="button"
              className={dashButtonSecondary}
              disabled={BigInt(payable) <= 0n}
              onClick={() => setReleasing(true)}
            >
              Release
            </button>
          }
        >
          {!data || data.accounts.length === 0 ? (
            <EmptyState title="No entries yet">
              The first payment you take writes the first lines here: cash in,
              PayPal&rsquo;s fee out, the rest owed onward to you.
            </EmptyState>
          ) : (
            <Ledger className="border-0 border-t border-(--dash-line-solid)">
              {data.accounts.map((account) => (
                <ListRow
                  key={account.account}
                  title={
                    <span className="font-medium">
                      {accountLabel(account.kind, account.account)}
                    </span>
                  }
                  meta={account.account}
                  trailing={
                    <Money
                      minor={account.balanceMinor}
                      currency={account.currency}
                    />
                  }
                />
              ))}
            </Ledger>
          )}
        </Panel>

        <Panel
          title="Recent payments"
          hint="What PayPal confirmed, and what it kept."
        >
          {!data || data.payments.length === 0 ? (
            <EmptyState
              title="No payments yet"
              action={
                <Link href="/invoices" className={dashButtonSecondary}>
                  Write an invoice
                </Link>
              }
            >
              Send someone an invoice or a link, and the moment they pay it
              lands here.
            </EmptyState>
          ) : (
            <Ledger className="border-0 border-t border-(--dash-line-solid)">
              {data.payments.map((payment) => (
                <ListRow
                  key={payment.id}
                  title={
                    <span className="font-medium">{payment.invoiceNumber}</span>
                  }
                  meta={`${payment.clientName} · fee ${formatMinor(
                    BigInt(payment.feeMinor),
                    payment.currency,
                  )} · ${new Date(payment.capturedAt).toLocaleDateString()}`}
                  trailing={
                    <Money
                      minor={payment.capturedMinor}
                      currency={payment.currency}
                    />
                  }
                />
              ))}
            </Ledger>
          )}
        </Panel>
      </div>

      <ApprovalsPanel />

      <SplitRulesPanel rules={data?.rules ?? []} />

      <Panel
        title="Latest invoices"
        hint={`Everything you have billed as @${username}.`}
        action={
          <Link href="/invoices" className={dashButtonSecondary}>
            All invoices
          </Link>
        }
      >
        {!data || data.recentInvoices.length === 0 ? (
          <EmptyState
            title="Nothing billed yet"
            action={
              <Link href="/invoices" className={dashButtonSecondary}>
                Write the first one
              </Link>
            }
          >
            An invoice gives your client a page to pay on and tells you the
            moment it is paid.
          </EmptyState>
        ) : (
          <Ledger className="border-0 border-t border-(--dash-line-solid)">
            {data.recentInvoices.map((invoice) => (
              <ListRow
                key={invoice.id}
                title={
                  <>
                    <span className="font-medium">{invoice.number}</span>
                    <StatusChip
                      status={invoiceStatus(invoice.status, invoice.dueDate)}
                    />
                  </>
                }
                meta={`${invoice.clientName} · due ${invoice.dueDate}`}
                trailing={
                  <Money
                    minor={invoice.totalMinor}
                    currency={invoice.currency}
                  />
                }
              />
            ))}
          </Ledger>
        )}
      </Panel>

      <ReleaseDialog
        open={releasing}
        onOpenChange={setReleasing}
        payableMinor={payable}
      />
    </div>
  );
}

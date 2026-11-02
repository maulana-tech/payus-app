"use client";

import { Check, Copy } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { formatMinor } from "@/features/invoices/money";
import { cn } from "@/lib/utils";
import { dashCell, dashFocus, dashLedger } from "../styles";

// The shared vocabulary of the built screens: a hairline panel, rows that
// divide into cells, status chips, money, and a copy button. Anything a
// screen needs twice belongs here.

export function Panel({
  title,
  hint,
  action,
  children,
  className,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-(--dash-radius) border border-(--dash-line-solid) bg-(--dash-surface)",
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-(--dash-line) px-5 py-4">
        <div className="min-w-0">
          <h2 className="dashboard-tile-title">{title}</h2>
          {hint ? (
            <p className="mt-1 text-sm text-(--dash-ash)">{hint}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** A hairline grid: every child becomes a sharp cell. */
export function Ledger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(dashLedger, className)}>{children}</div>;
}

export function Cell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(dashCell, "p-5", className)}>{children}</div>;
}

/** A labelled number, the way the overview shows one. */
export function Stat({
  label,
  value,
  foot,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <Cell>
      <p className="text-[11px] font-semibold tracking-[0.14em] text-(--dash-ash) uppercase">
        {label}
      </p>
      <p className="mt-3 text-[clamp(1.5rem,2.4vw,2rem)] leading-none font-normal tracking-tight tabular-nums">
        {value}
      </p>
      {foot ? <p className="mt-2 text-sm text-(--dash-ash)">{foot}</p> : null}
    </Cell>
  );
}

export function Money({
  minor,
  currency = "USD",
  className,
}: {
  minor: string | bigint;
  currency?: string;
  className?: string;
}) {
  return (
    <span className={cn("tabular-nums", className)}>
      {formatMinor(BigInt(minor), currency)}
    </span>
  );
}

// The dashboard marks with weight, not hue: settled states are filled ink,
// open ones are a hairline, closed ones fade back.
const FILLED = "border-transparent bg-(--dash-fg) text-(--dash-surface)";
const OPEN = "border-(--dash-fg) text-(--dash-fg)";
const QUIET = "border-(--dash-line-strong) text-(--dash-ash)";

const CHIP: Record<string, string> = {
  paid: FILLED,
  active: OPEN,
  pending: QUIET,
  overdue: OPEN,
  void: `${QUIET} line-through`,
  archived: QUIET,
  // A shop is live or it is a draft; "active/archived" read as neither.
  live: OPEN,
  draft: QUIET,
  declined: QUIET,
  cancelled: QUIET,
};

export function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.1em] uppercase",
        CHIP[status] ?? CHIP.pending,
      )}
    >
      {status}
    </span>
  );
}

/** Copies a value and says so, without a toast. */
export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1.5 text-[13px] font-medium text-(--dash-ash) transition-colors hover:text-(--dash-fg)",
        dashFocus,
        className,
      )}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? (
        <Check className="size-3.5" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}

// Ledger account ids are machine-shaped; these are the words for them.
const ACCOUNT_LABEL: Record<string, string> = {
  in_flight: "Taken, not yet split",
  merchant_payable: "Owed to you",
  tax_reserve: "Set aside for tax",
  platform_fee: "Platform fee",
  paypal_cash: "Held at PayPal",
  psp_fee: "PayPal's fee",
  external: "Outside this system",
};

/** What to call a ledger account on screen. */
export function accountLabel(kind: string, accountId: string): string {
  if (kind === "pos") return `Pot · ${accountId.split(":")[2] ?? ""}`;
  return ACCOUNT_LABEL[kind] ?? accountId;
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-lg font-normal tracking-tight">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-(--dash-ash)">
        {children}
      </p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/** A row of the list screens: title line, meta line, trailing controls. */
export function ListRow({
  lead,
  title,
  meta,
  trailing,
  actions,
}: {
  lead?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn(
        dashCell,
        "flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4",
      )}
    >
      {lead ? <div className="shrink-0">{lead}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">{title}</div>
        {meta ? (
          <p className="mt-1 truncate text-sm text-(--dash-ash)">{meta}</p>
        ) : null}
      </div>
      {trailing ? (
        <div className="text-right text-[15px] font-medium">{trailing}</div>
      ) : null}
      {actions ? (
        <div className="flex shrink-0 items-center gap-3">{actions}</div>
      ) : null}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="px-5 py-3 text-sm text-(--dash-err)">
      {children}
    </p>
  );
}

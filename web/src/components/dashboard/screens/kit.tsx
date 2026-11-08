"use client";

import type { LucideIcon } from "lucide-react";
import { Check, Copy, MoreHorizontal } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMinor } from "@/features/invoices/money";
import { cn } from "@/lib/utils";
import { dashCell, dashFocus, dashIconButton, dashLedger } from "../styles";

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
        // min-w-0 is load-bearing: as a grid item the default is
        // `min-width: auto`, so one unbreakable line inside (a truncated
        // meta line is `white-space: nowrap`, and nowrap text has a
        // min-content width of the whole string) widens the track for every
        // panel on the screen, and the page is clipped, not scrolled.
        "min-w-0 rounded-(--dash-radius) border border-(--dash-line-solid) bg-(--dash-surface)",
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

/**
 * A hairline grid: every child becomes a sharp cell.
 *
 * Set `--row-actions` in `style` to reserve one width for every row's
 * controls. Without it each row's amount stops wherever that row's buttons
 * happen to start, and a column of money reads as a ragged edge — which on
 * a ledger is the one thing it must not do.
 */
export function Ledger({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cn(dashLedger, className)} style={style}>
      {children}
    </div>
  );
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
  // Quieter than "overdue" on purpose: an invoice can be both, and the
  // late one is the one that needs reading first.
  "part paid": QUIET,
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
        // -my-2 keeps the row's rhythm while the padding lifts the hit area
        // from 20px to 36px: at 20px this was the smallest target on the
        // screen, well under the 24px floor.
        "inline-flex items-center gap-1.5 -my-2 py-2 text-[13px] font-medium text-(--dash-ash) transition-colors hover:text-(--dash-fg)",
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

/**
 * The second control on a row, and the only one that is ever an icon alone.
 *
 * Rows used to carry four or five pills of equal weight, which made the
 * destructive one — an unlabelled bin between two words — the hardest thing
 * on the row to notice, and made every row a different width, so the amounts
 * beside them never lined up. One pill and this.
 */
export function RowMenu({
  label,
  children,
}: {
  /** Names the row, e.g. "More for INV-001": the icon says nothing alone. */
  label: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={dashIconButton} aria-label={label}>
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One action in a row's menu.
 *
 * The handler is `onClick` because that is what Base UI's `Menu.Item`
 * declares. It was `onSelect` — Radix's name for the same thing — which
 * React accepts without complaint on any element, since `onSelect` is a
 * real DOM event for selecting *text*. So it type-checked, rendered, and
 * attached a handler to an event a click never fires: every action behind
 * every row menu in the dashboard did nothing at all.
 */
export function RowMenuItem({
  icon: Icon,
  onClick,
  disabled,
  destructive = false,
  children,
}: {
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      variant={destructive ? "destructive" : "default"}
      onClick={onClick}
    >
      <Icon aria-hidden="true" />
      {children}
    </DropdownMenuItem>
  );
}

export { DropdownMenuSeparator as RowMenuSeparator };

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
      {/* A basis wide enough to read: without one the actions (which cannot
          shrink) crush the name to "INV-" / "002" on a phone instead of
          wrapping to their own line. */}
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-2">{title}</div>
        {meta ? (
          <p className="mt-1 truncate text-sm text-(--dash-ash)">{meta}</p>
        ) : null}
      </div>
      {trailing ? (
        <div className="shrink-0 text-right text-[15px] font-medium">
          {trailing}
        </div>
      ) : null}
      {actions ? (
        // Wrapping, not `shrink-0`: five controls on a phone are wider than
        // the screen, and a row that cannot wrap pushes the whole page
        // sideways instead.
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-3 sm:w-[var(--row-actions,auto)]">
          {actions}
        </div>
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

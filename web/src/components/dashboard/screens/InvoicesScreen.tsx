"use client";

import {
  Check,
  ExternalLink,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { invoiceStatus, suggestNextNumber } from "@/features/invoices/input";
import { formatMinor, toMinor } from "@/features/invoices/money";
import type { InvoiceView } from "@/features/invoices/types";
import { trpc } from "@/trpc/react";
import { Segmented } from "../Segmented";
import {
  dashButtonPrimary,
  dashButtonSecondary,
  dashIconButton,
} from "../styles";
import { ChaseDialog } from "./ChaseDialog";
import {
  EmptyState,
  ErrorNote,
  Ledger,
  ListRow,
  Money,
  Panel,
  StatusChip,
} from "./kit";
import { RefundDialog } from "./RefundDialog";

type Filter = "open" | "paid" | "all";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "paid", label: "Paid" },
  { value: "all", label: "All" },
];

const origin = () =>
  typeof window === "undefined" ? "" : window.location.origin;

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export function InvoicesScreen() {
  const list = trpc.invoices.list.useQuery();
  const [filter, setFilter] = useState<Filter>("open");
  const [composing, setComposing] = useState(false);

  const invoices = list.data ?? [];
  const shown = invoices.filter((invoice) =>
    filter === "all"
      ? true
      : filter === "paid"
        ? invoice.status === "paid"
        : invoice.status === "pending",
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          aria-label="Filter invoices"
          className="w-auto"
          options={FILTERS}
          value={filter}
          onChange={setFilter}
        />
        <button
          type="button"
          className={dashButtonPrimary}
          onClick={() => setComposing(true)}
        >
          <Plus aria-hidden="true" />
          New invoice
        </button>
      </div>

      <Panel
        title={
          filter === "paid"
            ? "Paid"
            : filter === "open"
              ? "Open"
              : "All invoices"
        }
        hint="A client pays from the link; the invoice settles itself."
      >
        {list.isLoading ? (
          <div className="px-5 py-12 text-center text-sm text-(--dash-ash)">
            Loading…
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            title={filter === "paid" ? "Nothing paid yet" : "No invoices yet"}
            action={
              <button
                type="button"
                className={dashButtonSecondary}
                onClick={() => setComposing(true)}
              >
                Write the first one
              </button>
            }
          >
            An invoice gives your client a page to pay on and tells you the
            moment it is paid.
          </EmptyState>
        ) : (
          <Ledger
            className="border-0 border-t border-(--dash-line-solid)"
            // Wide enough for "Mark paid" and the menu; every row reserves
            // it, so every amount stops at the same place.
            style={{ "--row-actions": "12.5rem" } as CSSProperties}
          >
            {shown.map((invoice) => (
              <InvoiceRow key={invoice.id} invoice={invoice} />
            ))}
          </Ledger>
        )}
      </Panel>

      <ComposeDialog
        open={composing}
        onOpenChange={setComposing}
        existing={invoices}
      />
    </div>
  );
}

function InvoiceRow({ invoice }: { invoice: InvoiceView }) {
  const utils = trpc.useUtils();
  const [refunding, setRefunding] = useState(false);
  const [chasing, setChasing] = useState(false);
  const refresh = () => {
    void utils.invoices.list.invalidate();
    void utils.ledger.summary.invalidate();
  };
  const markPaid = trpc.invoices.reportPayment.useMutation({
    onSuccess: refresh,
  });
  const voidInvoice = trpc.invoices.void.useMutation({ onSuccess: refresh });
  const stopRecurring = trpc.invoices.stopRecurring.useMutation({
    onSuccess: refresh,
  });
  const status = invoiceStatus(invoice.status, invoice.dueDate);
  const paid = BigInt(invoice.paidMinor);
  // Both marks can be true at once: an invoice is late *and* part paid, and
  // reading only "overdue" beside a number that has already moved is what
  // made the row confusing.
  const partPaid =
    invoice.status === "pending" &&
    paid > 0n &&
    paid < BigInt(invoice.totalMinor);
  const url = `${origin()}/i/${invoice.token}`;
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  const error =
    markPaid.error?.message ??
    voidInvoice.error?.message ??
    stopRecurring.error?.message;

  return (
    <div>
      <ListRow
        title={
          <>
            <span className="font-medium">{invoice.number}</span>
            <StatusChip status={status} />
            {partPaid ? <StatusChip status="part paid" /> : null}
            {invoice.recurrence !== "none" ? (
              <span className="text-[11px] font-semibold tracking-[0.1em] text-(--dash-ash) uppercase">
                {invoice.recurrence}
              </span>
            ) : null}
          </>
        }
        meta={`${invoice.clientName} · due ${invoice.dueDate}${
          invoice.status === "pending" && BigInt(invoice.paidMinor) > 0n
            ? ` · ${formatMinor(BigInt(invoice.paidMinor), invoice.currency)} received`
            : ""
        }`}
        trailing={
          <Money minor={invoice.totalMinor} currency={invoice.currency} />
        }
        // One pill and one menu, always — five controls of equal weight made
        // the destructive one (an unlabelled bin) the hardest to notice, and
        // a row whose buttons change width moves the amount beside it.
        actions={
          <>
            {invoice.status === "pending" ? (
              <button
                type="button"
                className={dashButtonSecondary}
                disabled={markPaid.isPending}
                onClick={() =>
                  markPaid.mutate({
                    id: invoice.id,
                    paidMinor: invoice.totalMinor,
                  })
                }
              >
                <Check aria-hidden="true" />
                Mark paid
              </button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger
                className={dashIconButton}
                aria-label={`More for ${invoice.number}`}
              >
                <MoreHorizontal aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuItem onSelect={() => void copyLink()}>
                  <Link2 aria-hidden="true" />
                  {copied ? "Link copied" : "Copy the pay link"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    window.open(`/i/${invoice.token}`, "_blank", "noreferrer")
                  }
                >
                  <ExternalLink aria-hidden="true" />
                  Open the pay page
                </DropdownMenuItem>
                {status === "overdue" ? (
                  <DropdownMenuItem onSelect={() => setChasing(true)}>
                    <MessageSquare aria-hidden="true" />
                    Ask the Collector to chase
                  </DropdownMenuItem>
                ) : null}
                {BigInt(invoice.paidMinor) > 0n ? (
                  <DropdownMenuItem onSelect={() => setRefunding(true)}>
                    <RotateCcw aria-hidden="true" />
                    Refund part or all of it
                  </DropdownMenuItem>
                ) : null}
                {invoice.recurrence !== "none" ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={stopRecurring.isPending}
                      onSelect={() => stopRecurring.mutate({ id: invoice.id })}
                    >
                      <XCircle aria-hidden="true" />
                      Stop issuing this {invoice.recurrence}
                    </DropdownMenuItem>
                  </>
                ) : null}
                {invoice.status === "pending" ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={voidInvoice.isPending}
                      onSelect={() => voidInvoice.mutate({ id: invoice.id })}
                    >
                      <Trash2 aria-hidden="true" />
                      Void {invoice.number}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <ChaseDialog
        open={chasing}
        onOpenChange={setChasing}
        invoiceId={invoice.id}
        invoiceNumber={invoice.number}
      />
      <RefundDialog
        open={refunding}
        onOpenChange={setRefunding}
        invoiceId={invoice.id}
        invoiceNumber={invoice.number}
        currency={invoice.currency}
      />
    </div>
  );
}

type Line = { description: string; quantity: string; unitPrice: string };
const emptyLine: Line = { description: "", quantity: "1", unitPrice: "" };

function ComposeDialog({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: InvoiceView[];
}) {
  const utils = trpc.useUtils();
  const suggested = useMemo(() => {
    const taken = new Set(existing.map((i) => i.number));
    const latest = existing[0]?.number;
    return latest ? suggestNextNumber(latest, taken) : "INV-001";
  }, [existing]);

  const [number, setNumber] = useState(suggested);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [dueDate, setDueDate] = useState(inDays(14));
  const [recurrence, setRecurrence] = useState<"none" | "weekly" | "monthly">(
    "none",
  );
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [touched, setTouched] = useState(false);

  // The suggestion depends on a list that loads after this mounts.
  if (!touched && number !== suggested) setNumber(suggested);

  const create = trpc.invoices.create.useMutation({
    onSuccess: () => {
      void utils.invoices.list.invalidate();
      void utils.ledger.summary.invalidate();
      onOpenChange(false);
      setClientName("");
      setClientEmail("");
      setNotes("");
      setLines([{ ...emptyLine }]);
      setTouched(false);
    },
  });

  let totalMinor = 0n;
  let totalReadable = true;
  for (const line of lines) {
    try {
      totalMinor +=
        BigInt(line.quantity || "0") * toMinor(line.unitPrice || "0");
    } catch {
      totalReadable = false;
    }
  }

  const setLine = (index: number, patch: Partial<Line>) =>
    setLines((all) =>
      all.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );

  const submit = () =>
    create.mutate({
      number,
      clientName,
      clientEmail: clientEmail || undefined,
      dueDate,
      notes,
      recurrence,
      items: lines.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity) || 1,
        unitPrice: line.unitPrice,
      })),
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>
            It gets its own page to pay on. Add an email and the client is told
            when it is issued, reminded when it is late, and sent a receipt when
            it is paid.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Number">
              <Input
                value={number}
                onChange={(e) => {
                  setTouched(true);
                  setNumber(e.target.value);
                }}
                required
              />
            </Field>
            <Field label="Due date">
              <Input
                type="date"
                value={dueDate}
                min={today()}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </Field>
            <Field label="Client">
              <Input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Acme Inc."
                required
              />
            </Field>
            <Field label="Client email" hint="Optional">
              <Input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="ap@acme.com"
              />
            </Field>
          </div>

          <fieldset className="grid gap-3">
            <legend className="text-[11px] font-semibold tracking-[0.14em] text-(--dash-ash) uppercase">
              Lines
            </legend>
            {lines.map((line, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: the rows are positional and reorderable only by edit
                key={index}
                className="grid grid-cols-[1fr_4.5rem_6.5rem_auto] items-center gap-2"
              >
                <Input
                  value={line.description}
                  onChange={(e) =>
                    setLine(index, { description: e.target.value })
                  }
                  placeholder="What it is for"
                  aria-label={`Line ${index + 1} description`}
                  required
                />
                <Input
                  value={line.quantity}
                  inputMode="numeric"
                  onChange={(e) => setLine(index, { quantity: e.target.value })}
                  aria-label={`Line ${index + 1} quantity`}
                  required
                />
                <Input
                  value={line.unitPrice}
                  inputMode="decimal"
                  placeholder="0.00"
                  onChange={(e) =>
                    setLine(index, { unitPrice: e.target.value })
                  }
                  aria-label={`Line ${index + 1} unit price`}
                  required
                />
                <button
                  type="button"
                  className={dashIconButton}
                  aria-label={`Remove line ${index + 1}`}
                  disabled={lines.length === 1}
                  onClick={() =>
                    setLines((all) => all.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <button
                type="button"
                className={dashButtonSecondary}
                onClick={() => setLines((all) => [...all, { ...emptyLine }])}
              >
                <Plus aria-hidden="true" />
                Add line
              </button>
              <p className="text-sm text-(--dash-ash)">
                Total{" "}
                <span className="font-medium text-(--dash-fg) tabular-nums">
                  {totalReadable ? formatMinor(totalMinor) : "—"}
                </span>
              </p>
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Repeats">
              <select
                value={recurrence}
                onChange={(e) =>
                  setRecurrence(e.target.value as typeof recurrence)
                }
                className="h-10 w-full rounded-lg border border-input bg-card/70 px-3 text-sm"
              >
                <option value="none">Once</option>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
              </select>
            </Field>
            <Field label="Note" hint="Shown on the invoice">
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Thanks for your business"
              />
            </Field>
          </div>

          {create.error ? <ErrorNote>{create.error.message}</ErrorNote> : null}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              className={dashButtonSecondary}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={dashButtonPrimary}
              disabled={create.isPending}
            >
              {create.isPending ? "Creating…" : "Create invoice"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  // The hint carries no extra opacity: ash on surface is 4.9:1, and 70% of
  // that is 3.3:1 — under the 4.5:1 an 11px label needs. Lowercase and
  // normal tracking already separate the hint from the label.
  return (
    <Label className="grid gap-1.5">
      <span className="text-[11px] font-semibold tracking-[0.14em] text-(--dash-ash) uppercase">
        {label}
        {hint ? (
          <span className="ml-2 tracking-normal normal-case">{hint}</span>
        ) : null}
      </span>
      {children}
    </Label>
  );
}

"use client";

import { Archive, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMinor, toMinor } from "@/features/invoices/money";
import {
  BASIS_POINTS,
  evaluateSplit,
  type SplitRule,
} from "@/features/split/evaluate";
import type { RouterOutputs } from "@/server/root";
import { trpc } from "@/trpc/react";
import {
  dashButtonPrimary,
  dashButtonSecondary,
  dashIconButton,
} from "../styles";
import { Field } from "./InvoicesScreen";
import {
  EmptyState,
  ErrorNote,
  Ledger,
  ListRow,
  Panel,
  StatusChip,
} from "./kit";

// The rules that divide money the moment it arrives, with the arithmetic
// shown rather than described: the preview underneath runs the same engine
// the server runs.

type Rule = RouterOutputs["ledger"]["summary"]["rules"][number];

const PREVIEW_ON = 10_000n; // $100.00

export function targetLabel(target: string): string {
  if (target === "platform_fee") return "Platform fee";
  if (target === "tax_reserve") return "Tax";
  if (target === "merchant_payable") return "Yours";
  return `Pot · ${target.slice(4)}`;
}

const ruleAmount = (rule: { kind: string; value: string }) =>
  rule.kind === "percent"
    ? `${(Number(rule.value) / 100).toString()}%`
    : formatMinor(BigInt(rule.value));

export function SplitRulesPanel({ rules }: { rules: Rule[] }) {
  const [adding, setAdding] = useState(false);
  const active = rules.filter((rule) => rule.state === "active");

  const preview = evaluateSplit(
    PREVIEW_ON,
    active.map(
      (rule): SplitRule => ({
        id: rule.id,
        name: rule.name,
        target: rule.target,
        kind: rule.kind,
        value: BigInt(rule.value),
        priority: rule.priority,
      }),
    ),
  );

  return (
    <Panel
      title="How money is divided"
      hint="Applied the moment a payment is taken, before anything is owed to you."
      action={
        <div className="flex flex-wrap items-center gap-3">
          <AskTheAllocator />
          <button
            type="button"
            className={dashButtonSecondary}
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden="true" />
            Add rule
          </button>
        </div>
      }
    >
      {rules.length === 0 ? (
        <EmptyState
          title="Everything goes straight to you"
          action={
            <button
              type="button"
              className={dashButtonSecondary}
              onClick={() => setAdding(true)}
            >
              Set money aside
            </button>
          }
        >
          Add a rule and every payment divides itself: a share for tax, a pot
          for something you are saving for, the rest yours.
        </EmptyState>
      ) : (
        <>
          <Ledger className="border-0 border-t border-(--dash-line-solid)">
            {rules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} />
            ))}
          </Ledger>
          <div className="border-t border-(--dash-line-solid) px-5 py-4 text-sm">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-(--dash-ash) uppercase">
              On a {formatMinor(PREVIEW_ON)} payment
            </p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
              {preview.map((allocation) => (
                <span key={`${allocation.ruleId ?? "rest"}`}>
                  <span className="text-(--dash-ash)">{allocation.name} </span>
                  {formatMinor(allocation.amountMinor)}
                </span>
              ))}
            </p>
          </div>
        </>
      )}
      <AddRuleDialog
        open={adding}
        onOpenChange={setAdding}
        nextPriority={
          rules.reduce((max, rule) => Math.max(max, rule.priority), -1) + 1
        }
      />
    </Panel>
  );
}

/**
 * The Allocator, from the panel its answer would change. It proposes; the
 * Guardian decides whether the change applies now or waits for the owner.
 */
function AskTheAllocator() {
  const utils = trpc.useUtils();
  const status = trpc.agents.status.useQuery();
  const [said, setSaid] = useState<string | null>(null);
  const run = trpc.agents.runAllocator.useMutation({
    onSuccess: (result) => {
      void utils.ledger.summary.invalidate();
      void utils.guardian.overview.invalidate();
      setSaid(
        result.act === "none"
          ? result.reason
          : result.proposal?.status === "executed"
            ? `${result.reason} It was inside your limits, so it is in effect.`
            : `${result.reason} It is waiting for you to approve.`,
      );
    },
    onError: () => setSaid(null),
  });

  if (status.data && !status.data.configured) return null;

  return (
    <div className="grid justify-items-end gap-1.5">
      <button
        type="button"
        className={dashButtonSecondary}
        disabled={run.isPending}
        onClick={() => {
          setSaid(null);
          run.mutate();
        }}
      >
        {run.isPending ? "Thinking…" : "Ask the Allocator"}
      </button>
      {said ? (
        <p className="max-w-sm text-right text-sm text-(--dash-ash)">{said}</p>
      ) : null}
      {run.error ? (
        <p
          className="max-w-sm text-right text-sm text-(--dash-err)"
          role="alert"
        >
          {run.error.message}
        </p>
      ) : null}
    </div>
  );
}

function RuleRow({ rule }: { rule: Rule }) {
  const utils = trpc.useUtils();
  const update = trpc.ledger.updateRule.useMutation({
    onSuccess: () => void utils.ledger.summary.invalidate(),
  });
  const archived = rule.state === "archived";
  return (
    <div>
      <ListRow
        title={
          <>
            <span className="font-medium">{rule.name}</span>
            {archived ? <StatusChip status="archived" /> : null}
          </>
        }
        meta={`${targetLabel(rule.target)} · priority ${rule.priority}`}
        trailing={ruleAmount(rule)}
        actions={
          <button
            type="button"
            className={dashIconButton}
            aria-label={
              archived ? `Restore ${rule.name}` : `Archive ${rule.name}`
            }
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                id: rule.id,
                state: archived ? "active" : "archived",
              })
            }
          >
            {archived ? (
              <RotateCcw aria-hidden="true" />
            ) : (
              <Archive aria-hidden="true" />
            )}
          </button>
        }
      />
      {update.error ? <ErrorNote>{update.error.message}</ErrorNote> : null}
    </div>
  );
}

type Where = "tax_reserve" | "pos" | "platform_fee";

function AddRuleDialog({
  open,
  onOpenChange,
  nextPriority,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nextPriority: number;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [where, setWhere] = useState<Where>("tax_reserve");
  const [pot, setPot] = useState("");
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState("");

  const create = trpc.ledger.createRule.useMutation({
    onSuccess: () => {
      void utils.ledger.summary.invalidate();
      onOpenChange(false);
      setName("");
      setValue("");
      setPot("");
    },
  });

  const submit = () => {
    setProblem("");
    const target =
      where === "pos"
        ? `pos:${pot
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")}`
        : where;
    let minorOrBp: bigint;
    try {
      // A percentage is stored in basis points: "10" is 1000.
      minorOrBp =
        kind === "percent"
          ? BigInt(Math.round(Number(value) * 100))
          : toMinor(value);
    } catch {
      return setProblem(
        kind === "percent"
          ? "Enter a percentage like 10."
          : "Enter an amount like 2.50.",
      );
    }
    if (kind === "percent" && (minorOrBp <= 0n || minorOrBp > BASIS_POINTS))
      return setProblem("A percentage is between 0 and 100.");
    if (minorOrBp <= 0n) return setProblem("Enter an amount above zero.");
    create.mutate({
      name: name.trim(),
      target,
      kind,
      value: minorOrBp.toString(),
      priority: nextPriority,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a split rule</DialogTitle>
          <DialogDescription>
            Percentages are of the whole payment, not of what is left after the
            rules above. Whatever remains is yours.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tax"
              required
            />
          </Field>
          <Field label="Goes to">
            <select
              value={where}
              onChange={(e) => setWhere(e.target.value as Where)}
              className="h-10 w-full rounded-lg border border-input bg-card/70 px-3 text-sm"
            >
              <option value="tax_reserve">Tax set aside</option>
              <option value="pos">A pot of my own</option>
              <option value="platform_fee">Platform fee</option>
            </select>
          </Field>
          {where === "pos" ? (
            <Field label="Pot name" hint="Lowercase, hyphens">
              <Input
                value={pot}
                onChange={(e) => setPot(e.target.value)}
                placeholder="savings"
                required
              />
            </Field>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How much">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
                className="h-10 w-full rounded-lg border border-input bg-card/70 px-3 text-sm"
              >
                <option value="percent">A percentage</option>
                <option value="fixed">A fixed amount</option>
              </select>
            </Field>
            <Field label={kind === "percent" ? "Percent" : "Amount"}>
              <Input
                value={value}
                inputMode="decimal"
                onChange={(e) => setValue(e.target.value)}
                placeholder={kind === "percent" ? "10" : "2.50"}
                required
              />
            </Field>
          </div>
          {problem || create.error ? (
            <ErrorNote>{problem || create.error?.message}</ErrorNote>
          ) : null}
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
              {create.isPending ? "Adding…" : "Add rule"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

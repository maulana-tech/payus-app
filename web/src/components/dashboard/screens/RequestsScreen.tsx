"use client";

import { Send } from "lucide-react";
import { type CSSProperties, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toMinor } from "@/features/invoices/money";
import { newId } from "@/lib/ids";
import { seal } from "@/lib/sealedBox";
import type { RouterOutputs } from "@/server/root";
import { trpc } from "@/trpc/react";
import { useSession } from "../../SessionProvider";
import { Segmented } from "../Segmented";
import { dashButtonPrimary, dashButtonSecondary } from "../styles";
import { Field } from "./InvoicesScreen";
import {
  EmptyState,
  ErrorNote,
  Ledger,
  ListRow,
  Money,
  Panel,
  StatusChip,
} from "./kit";

// A request is end-to-end sealed: the server stores two ciphertexts and the
// two usernames, and never the amount. Everything readable on this screen is
// opened in the browser with the account's messaging key.

type Request = RouterOutputs["requests"]["list"][number];
type Direction = "incoming" | "outgoing";

const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: "incoming", label: "Asked of me" },
  { value: "outgoing", label: "I asked" },
];

export function RequestsScreen() {
  const [direction, setDirection] = useState<Direction>("incoming");
  const [asking, setAsking] = useState(false);
  const list = trpc.requests.list.useQuery({ direction });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          aria-label="Which requests"
          className="w-auto"
          options={DIRECTIONS}
          value={direction}
          onChange={setDirection}
        />
        <button
          type="button"
          className={dashButtonPrimary}
          onClick={() => setAsking(true)}
        >
          <Send aria-hidden="true" />
          Ask for money
        </button>
      </div>

      <Panel
        title={direction === "incoming" ? "Asked of me" : "I asked"}
        hint="The amount and the note are sealed to the two of you; the server keeps only who asked whom."
      >
        {list.isLoading ? (
          <div className="px-5 py-12 text-center text-sm text-(--dash-ash)">
            Loading…
          </div>
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState title="Nothing here">
            {direction === "incoming"
              ? "When someone asks you for money by username, it appears here."
              : "Ask another @username for money and it appears here until they settle it."}
          </EmptyState>
        ) : (
          <Ledger
            className="border-0 border-t border-(--dash-line-solid)"
            style={{ "--row-actions": "15rem" } as CSSProperties}
          >
            {(list.data ?? []).map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                direction={direction}
              />
            ))}
          </Ledger>
        )}
      </Panel>

      <AskDialog open={asking} onOpenChange={setAsking} />
    </div>
  );
}

function RequestRow({
  request,
  direction,
}: {
  request: Request;
  direction: Direction;
}) {
  const { openBox } = useSession();
  const utils = trpc.useUtils();
  const refresh = () => {
    void utils.requests.list.invalidate();
    void utils.requests.pendingCount.invalidate();
  };
  const markPaid = trpc.requests.markPaid.useMutation({ onSuccess: refresh });
  const decline = trpc.requests.decline.useMutation({ onSuccess: refresh });
  const cancel = trpc.requests.cancel.useMutation({ onSuccess: refresh });

  const payload = openBox<{ amountMinor: string; note: string }>(
    request.sealed,
  );
  const other = direction === "incoming" ? request.from : request.to;
  const error =
    markPaid.error?.message ?? decline.error?.message ?? cancel.error?.message;

  return (
    <div>
      <ListRow
        title={
          <>
            <span className="font-medium">@{other}</span>
            <StatusChip status={request.status} />
          </>
        }
        meta={
          payload
            ? payload.note || "No note"
            : "Locked — unlock your account to read this"
        }
        trailing={
          payload ? <Money minor={payload.amountMinor} /> : <span>•••</span>
        }
        actions={
          request.status !== "pending" ? null : direction === "incoming" ? (
            <>
              {/* The affirmative one leads: two identical pills make the
                  person read both before either means anything. */}
              <button
                type="button"
                className={dashButtonPrimary}
                disabled={markPaid.isPending}
                onClick={() => markPaid.mutate({ id: request.id })}
              >
                Mark paid
              </button>
              <button
                type="button"
                className={dashButtonSecondary}
                disabled={decline.isPending}
                onClick={() => decline.mutate({ id: request.id })}
              >
                Decline
              </button>
            </>
          ) : (
            <button
              type="button"
              className={dashButtonSecondary}
              disabled={cancel.isPending}
              onClick={() => cancel.mutate({ id: request.id })}
            >
              Cancel
            </button>
          )
        }
      />
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </div>
  );
}

function AskDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { messagingPubkey } = useSession();
  const utils = trpc.useUtils();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");

  const lookup = trpc.profiles.byUsername.useQuery(
    { username: to.trim().toLowerCase() },
    { enabled: to.trim().length >= 3 },
  );
  const create = trpc.requests.create.useMutation({
    onSuccess: () => {
      void utils.requests.list.invalidate();
      onOpenChange(false);
      setTo("");
      setAmount("");
      setNote("");
    },
  });

  const submit = () => {
    setProblem("");
    const mine = messagingPubkey();
    const them = lookup.data;
    if (!mine) return setProblem("Unlock your account first.");
    if (!them) return setProblem("No account with that username.");
    let amountMinor: string;
    try {
      amountMinor = toMinor(amount).toString();
    } catch {
      return setProblem("Enter an amount like 25.00.");
    }
    const payload = { amountMinor, note };
    create.mutate({
      id: newId(),
      to: them.username,
      forPayer: seal(payload, them.msgPubkeyHex),
      forRequester: seal(payload, mine),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ask for money</DialogTitle>
          <DialogDescription>
            Both copies are sealed in your browser — one for them, one for you.
            The server stores neither key.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field
            label="Username"
            hint={
              to.trim().length >= 3 && lookup.isFetched
                ? lookup.data
                  ? "Found"
                  : "Not found"
                : undefined
            }
          >
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value.replace(/^@/, ""))}
              placeholder="alex"
              required
            />
          </Field>
          <Field label="Amount">
            <Input
              value={amount}
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
              placeholder="25.00"
              required
            />
          </Field>
          <Field label="Note" hint="Optional">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Dinner on Friday"
            />
          </Field>
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
              {create.isPending ? "Sending…" : "Send request"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

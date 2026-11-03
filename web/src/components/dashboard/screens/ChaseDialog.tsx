"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/react";
import { dashButtonPrimary, dashButtonSecondary } from "../styles";
import { Field } from "./InvoicesScreen";
import { CopyButton, ErrorNote } from "./kit";

// The Collector drafts; you send. The text is editable before it goes,
// because it goes out under the owner's name and not ours — and whether a
// letter is due at all was decided in code before the model was asked.

export function ChaseDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
}) {
  const utils = trpc.useUtils();
  const chaseable = trpc.agents.chaseable.useQuery(undefined, {
    enabled: open,
  });
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  const draft = trpc.agents.runCollector.useMutation({
    onSuccess: (result) => {
      setSubject(result.subject);
      setBody(result.body);
    },
  });
  const send = trpc.agents.sendChase.useMutation({
    onSuccess: (result) => {
      void utils.invoices.list.invalidate();
      void utils.agents.chaseable.invalidate();
      setSent(
        result.sent
          ? `Sent to ${result.to}.`
          : `No mailer is configured on this deployment, so nothing was emailed — but ${invoiceNumber} is marked as asked. Copy the letter and send it yourself.`,
      );
    },
  });

  useEffect(() => {
    if (!open) return;
    setSubject("");
    setBody("");
    setSent(null);
  }, [open]);

  const row = (chaseable.data ?? []).find(
    (item) => item.invoiceId === invoiceId,
  );
  const stop = row?.stop ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Chase {invoiceNumber}</DialogTitle>
          <DialogDescription>
            The Collector writes it; you read it and send it. It knows the
            amount only because it was given it, and it never changes one.
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="grid gap-4">
            <p className="text-[15px] leading-relaxed">{sent}</p>
            <div className="flex justify-end">
              <button
                type="button"
                className={dashButtonPrimary}
                onClick={() => onOpenChange(false)}
              >
                Done
              </button>
            </div>
          </div>
        ) : stop ? (
          <div className="grid gap-4">
            <p className="text-[15px] leading-relaxed">{stop}</p>
            <div className="flex justify-end">
              <button
                type="button"
                className={dashButtonSecondary}
                onClick={() => onOpenChange(false)}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {row ? (
              <p className="text-sm text-(--dash-ash)">
                {row.clientName} · {row.daysOverdue} day
                {row.daysOverdue === 1 ? "" : "s"} overdue ·{" "}
                {row.asked === 0
                  ? "not asked yet"
                  : `asked ${row.asked} time${row.asked === 1 ? "" : "s"}`}
              </p>
            ) : null}

            {body ? (
              <>
                <Field label="Subject">
                  <Input
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                  />
                </Field>
                <Field label="The letter" hint="Edit it; it goes out as yours">
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    rows={12}
                    className="w-full rounded-lg border border-input bg-card/70 p-3 text-[15px] leading-relaxed"
                  />
                </Field>
              </>
            ) : (
              <p className="text-sm text-(--dash-ash)">Nothing drafted yet.</p>
            )}

            {draft.error ? <ErrorNote>{draft.error.message}</ErrorNote> : null}
            {send.error ? <ErrorNote>{send.error.message}</ErrorNote> : null}

            <div className="flex flex-wrap justify-end gap-3">
              {body ? (
                <CopyButton value={`${subject}\n\n${body}`} label="Copy" />
              ) : null}
              <button
                type="button"
                className={dashButtonSecondary}
                disabled={draft.isPending}
                onClick={() => draft.mutate({ invoiceId })}
              >
                {draft.isPending
                  ? "Writing…"
                  : body
                    ? "Write another"
                    : "Draft the letter"}
              </button>
              <button
                type="button"
                className={dashButtonPrimary}
                disabled={send.isPending || !body.trim() || !subject.trim()}
                onClick={() => send.mutate({ invoiceId, subject, body })}
              >
                {send.isPending ? "Sending…" : "Send it"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

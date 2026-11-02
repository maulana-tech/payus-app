"use client";

import { useState } from "react";
import { formatMinor } from "@/features/invoices/money";
import type { RouterOutputs } from "@/server/root";
import { trpc } from "@/trpc/react";
import { dashButtonPrimary, dashButtonSecondary } from "../styles";
import { EmptyState, ErrorNote, Ledger, ListRow, Panel } from "./kit";

// What the Guardian decided it wants the owner to see. Each card says the
// rule that stopped it, because an approval asked for without a reason is
// just a button.

type Proposal = RouterOutputs["guardian"]["overview"]["pending"][number];

const payload = (proposal: Proposal) =>
  proposal.payload as {
    amountMinor?: string;
    destination?: string;
  };

export function ApprovalsPanel() {
  const overview = trpc.guardian.overview.useQuery();
  const pending = overview.data?.pending ?? [];

  return (
    <Panel
      title="Waiting for you"
      hint="The Guardian holds these until you say so. Nothing has moved."
      action={<AskThePayer />}
    >
      {pending.length === 0 ? (
        <EmptyState title="Nothing to approve">
          Payments inside the limits you set go through on their own. Anything
          outside them stops here first.
        </EmptyState>
      ) : (
        <Ledger className="border-0 border-t border-(--dash-line-solid)">
          {pending.map((proposal) => (
            <ProposalRow key={proposal.id} proposal={proposal} />
          ))}
        </Ledger>
      )}
    </Panel>
  );
}

/**
 * Runs the Payer once. Whatever it answers — a proposal, a refusal with the
 * Guardian's reason, or "nothing to do" — is shown as it came back.
 */
function AskThePayer() {
  const utils = trpc.useUtils();
  const status = trpc.agents.status.useQuery();
  const [said, setSaid] = useState<string | null>(null);
  const run = trpc.agents.runPayer.useMutation({
    onSuccess: (result) => {
      void utils.guardian.overview.invalidate();
      void utils.ledger.summary.invalidate();
      void utils.ledger.entries.invalidate();
      setSaid(
        result.act === "none"
          ? result.reason
          : result.proposal?.status === "executed"
            ? `${result.reason} It was inside your limits, so it has been sent.`
            : result.reason,
      );
    },
    onError: () => setSaid(null),
  });

  if (status.data && !status.data.configured)
    return (
      <span className="text-sm text-(--dash-ash)">
        Agents are off: no Claude API key on this deployment.
      </span>
    );

  return (
    <div className="grid justify-items-end gap-2">
      <button
        type="button"
        className={dashButtonSecondary}
        disabled={run.isPending}
        onClick={() => {
          setSaid(null);
          run.mutate();
        }}
      >
        {run.isPending ? "Thinking…" : "Ask the Payer"}
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

function ProposalRow({ proposal }: { proposal: Proposal }) {
  const utils = trpc.useUtils();
  const refresh = () => {
    void utils.guardian.overview.invalidate();
    void utils.ledger.summary.invalidate();
    void utils.ledger.entries.invalidate();
  };
  const approve = trpc.guardian.approve.useMutation({ onSuccess: refresh });
  const refuse = trpc.guardian.refuse.useMutation({ onSuccess: refresh });
  const { amountMinor = "0", destination = "" } = payload(proposal);
  const expires = proposal.expiresAt ? new Date(proposal.expiresAt) : null;
  const error = approve.error?.message ?? refuse.error?.message;

  return (
    <div>
      <ListRow
        title={
          <>
            <span className="font-medium">
              Release {formatMinor(BigInt(amountMinor))}
            </span>
            <span className="text-[11px] font-semibold tracking-[0.1em] text-(--dash-ash) uppercase">
              asked by {proposal.proposedBy}
            </span>
          </>
        }
        meta={`${destination} · ${proposal.reason}${
          expires ? ` · expires ${expires.toLocaleTimeString()}` : ""
        }`}
        actions={
          <>
            <button
              type="button"
              className={dashButtonSecondary}
              disabled={refuse.isPending || approve.isPending}
              onClick={() => refuse.mutate({ id: proposal.id })}
            >
              Not this one
            </button>
            <button
              type="button"
              className={dashButtonPrimary}
              disabled={approve.isPending || refuse.isPending}
              onClick={() => approve.mutate({ id: proposal.id })}
            >
              {approve.isPending ? "Sending…" : "Approve"}
            </button>
          </>
        }
      />
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </div>
  );
}

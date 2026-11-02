"use client";

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

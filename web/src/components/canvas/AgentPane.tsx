"use client";

import {
  AlertTriangle,
  Check,
  Eye,
  Sparkles,
  Undo2,
  Wand2,
} from "lucide-react";
import { useState } from "react";
import { ErrorNote } from "@/components/dashboard/screens/kit";
import { dashFocus } from "@/components/dashboard/styles";
import type { Block } from "@/features/storefront/blocks";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

// The Builder, working on a shop that already exists.
//
// Two things it does, and they are different promises:
//
//   **Change** is an instruction the owner wrote, so the only guarantee is
//   that what comes back is blocks this page can hold and addresses this
//   account owns.
//   **Fix** is a finding *this application computed* — a check that came
//   out true, named by id. The model is handed one of those and nothing
//   else. It never decides what is wrong, because a model asked what is
//   wrong with a page will always answer something.
//
// Neither writes. What comes back fills the editor, the page on the right
// redraws, and the owner presses the same Save they always press. There is
// no second road into this shop.

type Proposal = {
  before: Block[];
  after: Block[];
  html: string;
  model: string;
};

const pill =
  "flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors";

/** What changed, counted over blocks rather than over characters. */
function difference(before: Block[], after: Block[]) {
  const was = before.map((block) => JSON.stringify({ ...block, id: 0 }));
  const now = after.map((block) => JSON.stringify({ ...block, id: 0 }));
  const kept = new Set(was.filter((one) => now.includes(one)));
  return {
    added: now.filter((one) => !kept.has(one)).length,
    removed: was.filter((one) => !kept.has(one)).length,
    same: kept.size,
  };
}

export function AgentPane({
  shopId,
  dirty,
  onApply,
}: {
  /** Null for a shop that has never been saved: there is nothing to read. */
  shopId: string | null;
  /** True when the editor holds changes the server has not seen. */
  dirty: boolean;
  onApply: (html: string) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const review = trpc.agents.reviewShop.useQuery(
    { shopId: shopId ?? "" },
    { enabled: Boolean(shopId) && !dirty },
  );

  const took = {
    onSuccess: (data: Proposal) => {
      setProposal(data);
      setFailed(null);
    },
    onError: (error: { message: string }) => {
      setProposal(null);
      setFailed(error.message);
    },
  };
  const edit = trpc.agents.editShop.useMutation(took);
  const fix = trpc.agents.fixShop.useMutation(took);
  const busy = edit.isPending || fix.isPending;

  if (!shopId)
    return (
      <p className="rounded-(--dash-radius-sm) border border-(--dash-line-strong) border-dashed p-4 text-sm text-(--dash-ash)">
        The Builder reads the shop as it is saved, so create this one as a draft
        first. Nothing is public until you publish it.
      </p>
    );

  if (dirty)
    return (
      <p className="rounded-(--dash-radius-sm) border border-(--dash-line-strong) border-dashed p-4 text-sm text-(--dash-ash)">
        You have changes the server has not seen. Save them first — otherwise
        the Builder would be working on a page other than the one in front of
        you.
      </p>
    );

  const findings = review.data?.findings ?? [];

  return (
    <div className="grid min-w-0 gap-4">
      {/* ---------------------------------------------------------- change */}
      <div className="grid min-w-0 gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-(--dash-ash)">
          Ask for a change
        </span>
        <textarea
          rows={3}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Add a section answering the three questions people always ask"
          className="w-full resize-y rounded-(--dash-radius-sm) border border-(--dash-line-strong) bg-(--dash-surface) px-2.5 py-2 text-sm leading-relaxed text-(--dash-fg) outline-none focus:border-(--dash-fg)"
        />
        <button
          type="button"
          disabled={busy || instruction.trim().length < 4}
          onClick={() =>
            edit.mutate({ shopId, instruction: instruction.trim() })
          }
          className={cn(
            pill,
            "w-fit border-(--dash-line-strong) text-(--dash-fg) hover:bg-(--dash-fg) hover:text-(--dash-surface) disabled:cursor-not-allowed disabled:opacity-40",
            dashFocus,
          )}
        >
          <Wand2 className="size-3.5" aria-hidden />
          {edit.isPending ? "Writing…" : "Ask the Builder"}
        </button>
        <p className="text-[12px] text-(--dash-ash)">
          It changes what you asked for and leaves the rest word for word. Your
          own hand-written markup is never touched.
        </p>
      </div>

      {/* --------------------------------------------------------- findings */}
      <div className="grid min-w-0 gap-2 border-t border-(--dash-line) pt-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-(--dash-ash)">
          What this page is flagged for
        </span>

        {review.isLoading ? (
          <p className="text-sm text-(--dash-ash)">Checking…</p>
        ) : findings.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-(--dash-ash)">
            <Check className="size-3.5" aria-hidden />
            Nothing. Every check this app makes came out clean.
          </p>
        ) : null}

        {findings.map((finding) => (
          <div
            key={finding.id}
            className="grid min-w-0 gap-1.5 rounded-(--dash-radius-sm) border border-(--dash-line-strong) p-3"
          >
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle
                className={cn(
                  "mt-0.5 size-3.5 shrink-0",
                  finding.severity === "stop"
                    ? "text-(--dash-err)"
                    : "text-(--dash-ash)",
                )}
                aria-hidden
              />
              <p className="min-w-0 text-sm text-(--dash-fg)">{finding.what}</p>
            </div>
            <p className="pl-5.5 text-[12px] text-(--dash-ash)">
              {finding.remedy}
            </p>
            <div className="flex justify-end">
              {finding.fixable ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fix.mutate({ shopId, findingId: finding.id })}
                  className={cn(
                    pill,
                    "border-(--dash-line-strong) text-(--dash-fg) hover:bg-(--dash-fg) hover:text-(--dash-surface) disabled:opacity-40",
                    dashFocus,
                  )}
                >
                  <Sparkles className="size-3.5" aria-hidden />
                  {fix.isPending ? "Writing…" : "Ask the Builder to fix it"}
                </button>
              ) : (
                // Said rather than fudged: the Builder writes the page, so
                // it cannot change what something costs or un-remove what
                // the sanitiser took out.
                <span className="text-[12px] text-(--dash-ash)">
                  Yours to do, not the Builder&rsquo;s.
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {failed ? <ErrorNote>{failed}</ErrorNote> : null}

      {/* -------------------------------------------------------- proposal */}
      {proposal ? (
        <div className="grid min-w-0 gap-2 rounded-(--dash-radius-sm) border border-(--dash-fg) p-3">
          <div className="flex items-center gap-2">
            <Eye className="size-3.5 text-(--dash-ash)" aria-hidden />
            <span className="text-sm font-medium">What it would do</span>
          </div>
          <Summary {...difference(proposal.before, proposal.after)} />
          <ul className="grid min-w-0 gap-1">
            {proposal.after.map((block, at) => (
              <li
                // Position is the identity here: these are a reading of a
                // page, not rows with ids of their own.
                // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity here.
                key={at}
                className="min-w-0 truncate text-[12px] text-(--dash-ash)"
              >
                {at + 1}. {block.kind}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setProposal(null)}
              className={cn(
                pill,
                "border-(--dash-line-strong) text-(--dash-ash) hover:text-(--dash-fg)",
                dashFocus,
              )}
            >
              <Undo2 className="size-3.5" aria-hidden />
              Discard
            </button>
            <button
              type="button"
              onClick={() => {
                onApply(proposal.html);
                setProposal(null);
                setInstruction("");
              }}
              className={cn(
                pill,
                "border-(--dash-fg) bg-(--dash-fg) text-(--dash-surface)",
                dashFocus,
              )}
            >
              <Check className="size-3.5" aria-hidden />
              Put it in the editor
            </button>
          </div>
          <p className="text-[12px] text-(--dash-ash)">
            Nothing is saved by this. It fills the editor; the page on the right
            redraws; Save is still yours. Written by {proposal.model}.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Summary({
  added,
  removed,
  same,
}: {
  added: number;
  removed: number;
  same: number;
}) {
  const parts = [
    added > 0 ? `${added} new` : null,
    removed > 0 ? `${removed} gone` : null,
    `${same} unchanged`,
  ].filter(Boolean);
  return (
    <p className="text-[12px] text-(--dash-ash) tabular-nums">
      {parts.join(" · ")}
    </p>
  );
}

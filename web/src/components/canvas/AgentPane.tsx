"use client";

import {
  AlertTriangle,
  ArrowUp,
  Check,
  ExternalLink,
  Eye,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ErrorNote } from "@/components/dashboard/screens/kit";
import { dashFocus } from "@/components/dashboard/styles";
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
// It is a conversation rather than a box, and that is not decoration: the
// second thing anyone says is "shorter", and that has to mean the page they
// were *just shown*, not the one on the server. So every answer carries the
// page it produced and the next ask starts from it.
//
// Nothing here writes. While an answer is open the page on the right **is**
// that answer, so it is judged as the page it would become rather than as a
// list of block names; applying it fills the editor, and the owner presses
// the same Save they always press.

/**
 * One answer, as both a live reply and a kept one.
 *
 * The kept form holds each block's kind and not the block, because the
 * screen shows kinds — and a page of 46 000 characters is not worth storing
 * twenty times for a list of nine words.
 */
type Proposal = {
  after: { id: string; kind: string }[];
  html: string;
  links: { href: string; text: string }[];
  skipped: string[];
  /** What it would do, in one line. Written by the server, not here. */
  summary: string;
  model: string | null;
};

/** One thing said, by either side. `Omit<Turn, "id">` over a union
    distributes into something no branch satisfies, so the id is added on
    top rather than removed afterwards. */
const pill =
  "flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors";

export function AgentPane({
  shopId,
  dirty,
  onApply,
  onPreview,
}: {
  /** Null for a shop that has never been saved: there is nothing to read. */
  shopId: string | null;
  /** True when the editor holds changes the server has not seen. */
  dirty: boolean;
  onApply: (html: string) => void;
  /** The page the canvas should draw instead of the draft, or null. */
  onPreview: (html: string | null) => void;
}) {
  const utils = trpc.useUtils();
  const [said, setSaid] = useState("");
  /** What is being asked right now, shown until the answer replaces it. */
  const [asking, setAsking] = useState<string | null>(null);
  /** The newest answer the owner has already dealt with, by turn id. */
  const [done, setDone] = useState<string | null>(null);
  const foot = useRef<HTMLDivElement>(null);

  // The thread lives on the server, so it survives a reload — and so there
  // is one answer to "what did I ask", not one per open tab.
  const thread = trpc.agents.shopThread.useQuery(
    { shopId: shopId ?? "" },
    { enabled: Boolean(shopId) },
  );
  const turns = thread.data ?? [];

  const review = trpc.agents.reviewShop.useQuery(
    { shopId: shopId ?? "" },
    { enabled: Boolean(shopId) && !dirty },
  );

  // The newest answer still waiting on the owner: what the canvas draws and
  // what the next instruction carries on from.
  const newest = [...turns].reverse().find((turn) => turn.proposal);
  const live = newest && newest.id !== done ? newest : null;

  const settled = {
    onSettled: () => {
      setAsking(null);
      void utils.agents.shopThread.invalidate();
    },
  };
  const edit = trpc.agents.editShop.useMutation(settled);
  const fix = trpc.agents.fixShop.useMutation(settled);
  const forget = trpc.agents.forgetShopThread.useMutation({
    onSuccess: () => void utils.agents.shopThread.invalidate(),
  });
  const busy = edit.isPending || fix.isPending;

  const page = live?.proposal?.html ?? null;
  // The canvas draws the newest answer for as long as one is open. This is
  // the whole point of proposing rather than writing: it is judged as the
  // page it would become, in the shop's own colours, at the width you chose.
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: `onPreview` is the parent's own setter and is stable; listing it would re-run this on every render of the canvas.
  useEffect(() => {
    onPreview(page);
    return () => onPreview(null);
  }, [page]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the count is the reason to scroll, not something the effect reads.
  useEffect(() => {
    foot.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length, busy]);

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
  const ask = (instruction: string) => {
    setAsking(instruction);
    edit.mutate({
      shopId,
      instruction,
      // A follow-up refines what you were just shown.
      ...(page ? { from: page } : {}),
    });
    setSaid("");
  };

  return (
    <div className="grid min-w-0 gap-4">
      {/* --------------------------------------------------------- findings */}
      {turns.length === 0 ? (
        <div className="grid min-w-0 gap-2">
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
                <p className="min-w-0 text-sm text-(--dash-fg)">
                  {finding.what}
                </p>
              </div>
              <p className="pl-5.5 text-[12px] text-(--dash-ash)">
                {finding.remedy}
              </p>
              <div className="flex justify-end">
                {finding.fixable ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setAsking(`Fix: ${finding.what}`);
                      fix.mutate({ shopId, findingId: finding.id });
                    }}
                    className={cn(
                      pill,
                      "border-(--dash-line-strong) text-(--dash-fg) hover:bg-(--dash-fg) hover:text-(--dash-surface) disabled:opacity-40",
                      dashFocus,
                    )}
                  >
                    <Sparkles className="size-3.5" aria-hidden />
                    Ask the Builder to fix it
                  </button>
                ) : (
                  // Said rather than fudged: the Builder writes the page,
                  // so it cannot change what something costs or un-remove
                  // what the sanitiser took out.
                  <span className="text-[12px] text-(--dash-ash)">
                    Yours to do, not the Builder&rsquo;s.
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* ------------------------------------------------------ the thread */}
      {turns.map((turn) => (
        <div key={turn.id} className="grid min-w-0 gap-2">
          <p className="ml-6 min-w-0 rounded-(--dash-radius-sm) border border-(--dash-line) bg-(--dash-tint) px-3 py-2 text-sm text-(--dash-fg)">
            {turn.asked}
          </p>
          {turn.failed ? (
            // A refusal is a record, not an error to swallow: a thread that
            // shows only what worked cannot explain why you asked twice.
            <ErrorNote>{turn.failed}</ErrorNote>
          ) : turn.proposal ? (
            <Answer
              proposal={{
                ...turn.proposal,
                summary: turn.summary ?? "",
                model: turn.model,
              }}
              showing={turn.id === live?.id}
              onApply={() => {
                onApply(turn.proposal?.html ?? "");
                setDone(turn.id);
              }}
              onDiscard={() => setDone(turn.id)}
            />
          ) : (
            // Its page came off when a newer answer arrived. What it did is
            // still here; it is just no longer the one you can apply.
            <p className="rounded-(--dash-radius-sm) border border-(--dash-line) p-3 text-[12px] text-(--dash-ash)">
              {turn.summary ?? "Answered."}
            </p>
          )}
        </div>
      ))}

      {turns.length > 0 && !busy ? (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={forget.isPending}
            onClick={() => forget.mutate({ shopId })}
            className={cn(
              "rounded-(--dash-radius-sm) px-2 py-1 text-[12px] text-(--dash-ash) hover:text-(--dash-fg) disabled:opacity-40",
              dashFocus,
            )}
          >
            Clear this conversation
          </button>
        </div>
      ) : null}

      {asking ? (
        <p className="ml-6 min-w-0 rounded-(--dash-radius-sm) border border-(--dash-line) bg-(--dash-tint) px-3 py-2 text-sm text-(--dash-fg)">
          {asking}
        </p>
      ) : null}

      {busy ? (
        <p className="flex items-center gap-2 text-sm text-(--dash-ash)">
          <Sparkles className="size-3.5 animate-pulse" aria-hidden />
          Writing…
        </p>
      ) : null}

      {/* ----------------------------------------------------------- asking */}
      <div className="grid min-w-0 gap-2 border-t border-(--dash-line) pt-4">
        <textarea
          rows={3}
          value={said}
          onChange={(event) => setSaid(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, because this is a conversation. A newline is
            // still there on Shift, and a long instruction is rare.
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            if (busy || said.trim().length < 4) return;
            ask(said.trim());
          }}
          placeholder={
            page
              ? "Now make the answers shorter"
              : "Add a section answering the three questions people always ask"
          }
          className="w-full resize-y rounded-(--dash-radius-sm) border border-(--dash-line-strong) bg-(--dash-surface) px-2.5 py-2 text-sm leading-relaxed text-(--dash-fg) outline-none focus:border-(--dash-fg)"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-[12px] text-(--dash-ash)">
            {page
              ? "Carries on from the page you are looking at."
              : "It changes what you asked for and leaves the rest word for word."}
          </p>
          <button
            type="button"
            disabled={busy || said.trim().length < 4}
            onClick={() => ask(said.trim())}
            className={cn(
              pill,
              "shrink-0 border-(--dash-fg) bg-(--dash-fg) text-(--dash-surface) disabled:cursor-not-allowed disabled:opacity-40",
              dashFocus,
            )}
          >
            <ArrowUp className="size-3.5" aria-hidden />
            Send
          </button>
        </div>
      </div>
      <div ref={foot} />
    </div>
  );
}

/** One answer: what it would do, where it would send people, and the choice. */
function Answer({
  proposal,
  showing,
  onApply,
  onDiscard,
}: {
  proposal: Proposal;
  /** True for the newest one, which is what the page on the right draws. */
  showing: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-2 rounded-(--dash-radius-sm) border p-3",
        showing ? "border-(--dash-fg)" : "border-(--dash-line) opacity-60",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Eye className="size-3.5 shrink-0 text-(--dash-ash)" aria-hidden />
        <span className="truncate text-sm font-medium">
          {showing ? "On the page to the right" : "Earlier"}
        </span>
        <span className="ml-auto shrink-0 text-[12px] text-(--dash-ash) tabular-nums">
          {proposal.summary}
        </span>
      </div>

      <ul className="grid min-w-0 gap-1">
        {proposal.after.map((block, at) => (
          <li
            // Position is the identity here: these are a reading of a page,
            // not rows with ids of their own.
            // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity here.
            key={at}
            className="min-w-0 truncate text-[12px] text-(--dash-ash)"
          >
            {at + 1}. {block.kind}
          </li>
        ))}
      </ul>

      {proposal.skipped.length > 0 ? (
        // Said, not swallowed. What was left out was empty, so nothing is
        // lost by dropping it — but the owner still gets to know that the
        // answer is not quite what the Builder set out to write.
        <p className="border-t border-(--dash-line) pt-2 text-[12px] text-(--dash-ash)">
          Left out because {proposal.skipped.length === 1 ? "it" : "they"}{" "}
          arrived empty: {proposal.skipped.join("; ")}.
        </p>
      ) : null}

      {proposal.links.length > 0 ? (
        <div className="grid min-w-0 gap-1 border-t border-(--dash-line) pt-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-(--dash-ash)">
            Where it sends people
          </span>
          {/* Openable, not described. An address on a page is a claim until
              someone follows it, and these are the addresses the Builder
              chose from the ones this account owns. */}
          {proposal.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "flex min-w-0 items-center gap-1.5 text-[12px] text-(--dash-fg) underline-offset-2 hover:underline",
                dashFocus,
              )}
            >
              <ExternalLink className="size-3 shrink-0" aria-hidden />
              <span className="shrink-0">{link.text}</span>
              <span className="min-w-0 truncate text-(--dash-ash)">
                {link.href}
              </span>
            </a>
          ))}
        </div>
      ) : null}

      {showing ? (
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onDiscard}
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
            onClick={onApply}
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
      ) : null}

      <p className="text-[12px] text-(--dash-ash)">
        Nothing is saved by this. Written by {proposal.model}.
      </p>
    </div>
  );
}

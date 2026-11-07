"use client";

import {
  ArrowRight,
  Check,
  ChevronRight,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/trpc/react";
import { RunPanel } from "../RunPanel";
import { dashFocus } from "../styles";
import { ErrorNote } from "./kit";

// The Advisor, given the room it needed.
//
// It used to be one line on the Overview with a button beside it, which is
// the wrong shape for the one seat you hold a conversation with: a question
// and its rows scrolled away the moment you asked the next one. A transcript
// is not a document on a page — it is the page, so the exchange scrolls
// against a composer that stays put.
//
// What it is NOT is a general assistant. The Advisor picks one of six
// queries we wrote, by name, and we run it scoped to you. That is why every
// answer carries the query it chose and the rows it read: an answer whose
// rows you cannot see is a claim, and this seat exists to settle questions
// rather than to make them.

type Row = Record<string, string>;

type Turn =
  | { from: "you"; text: string }
  | {
      from: "advisor";
      text: string;
      question: string;
      query: string;
      why: string;
      caption: string;
      rows: Row[];
      seconds: number;
      model: string;
      pickedBy: string;
    }
  | { from: "refused"; text: string };

/** The six, in the words someone would actually use. */
const EXAMPLES = [
  "Who still owes me money?",
  "What came in this week?",
  "How much have I set aside for tax?",
  "Has anything been refunded?",
] as const;

const COLUMN = "mx-auto w-full max-w-3xl";

export function AgentsScreen() {
  const status = trpc.agents.status.useQuery();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const started = useRef(0);
  // Which run's detail is open, by its index in the transcript.
  const [showing, setShowing] = useState<number | null>(null);

  const ask = trpc.agents.runAdvisor.useMutation({
    onSuccess: (reply) =>
      setTurns((t) => [
        ...t,
        {
          from: "advisor",
          text: reply.answer,
          question: reply.question,
          query: reply.query,
          why: reply.why,
          caption: reply.caption,
          rows: reply.rows,
          seconds: (Date.now() - started.current) / 1000,
          model: reply.model,
          pickedBy: reply.pickedBy,
        },
      ]),
    // A refusal is an answer too — it belongs in the transcript, in order,
    // not in a box above it that the next question wipes.
    onError: (error) =>
      setTurns((t) => [...t, { from: "refused", text: error.message }]),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the tail
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns.length, ask.isPending]);

  const send = (question: string) => {
    const q = question.trim();
    if (q.length < 3 || ask.isPending) return;
    setTurns((t) => [...t, { from: "you", text: q }]);
    setText("");
    started.current = Date.now();
    ask.mutate({ question: q });
  };

  if (status.data && !status.data.configured)
    return (
      <div className="grid place-items-center py-24 text-center">
        <div className="max-w-sm">
          <p className="text-lg">The seats that think are off</p>
          <p className="mt-2 text-sm leading-6 text-(--dash-ash)">
            No model is configured on this deployment, so the six that call one
            are not available. Everything on the money path is unaffected.
          </p>
        </div>
      </div>
    );

  const composer = (
    <form
      className="rounded-(--dash-radius) border border-(--dash-line-strong) bg-(--dash-surface) p-2.5 focus-within:border-(--dash-fg)"
      onSubmit={(event) => {
        event.preventDefault();
        send(text);
      }}
    >
      <textarea
        ref={field}
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Enter sends, Shift+Enter is a new line: the question is usually
          // one sentence, so the common case should not need the mouse.
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send(text);
          }
        }}
        placeholder="Ask about your money…"
        aria-label="Ask the Advisor"
        className={`max-h-48 min-h-12 w-full resize-none bg-transparent px-1.5 py-1 text-[15px] leading-relaxed outline-none placeholder:text-(--dash-ash) ${dashFocus}`}
      />
      <div className="mt-2 flex items-center justify-between gap-3 border-t border-(--dash-line) pt-2">
        <p className="text-[11px] text-(--dash-ash)">
          Reads your rows. It has no write access of any kind.
        </p>
        <button
          type="submit"
          disabled={ask.isPending || text.trim().length < 3}
          className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-(--dash-fg) px-4 text-[13px] font-semibold tracking-[0.08em] text-(--dash-surface) uppercase transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40 ${dashFocus}`}
        >
          {ask.isPending ? (
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
          ) : null}
          Ask
        </button>
      </div>
    </form>
  );

  const open = showing === null ? null : turns[showing];

  return (
    // Measured against the shell rather than guessed: the page header and
    // the main's own padding take 259px on a desktop and rather more on a
    // phone, where the tab bar is also in the way.
    <div className="flex h-[calc(100svh-19rem)] min-h-96 flex-col lg:h-[calc(100svh-17rem)]">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {turns.length === 0 && !ask.isPending ? (
          // Nothing asked yet: an introduction and the questions it can
          // actually answer. The composer does not move to meet them — a
          // reply box that travels is one you have to find twice.
          <div className="mx-auto flex h-full w-full max-w-xl flex-col justify-center py-6">
            <div className="text-center">
              <Sparkles
                className="mx-auto size-5 text-(--dash-ash)"
                aria-hidden
              />
              <h2 className="mt-3 text-xl tracking-tight">Ask the Advisor</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-(--dash-ash)">
                It does not write the query. It picks one of six we wrote, we
                run it scoped to you, and the rows come back under the answer.
              </p>
            </div>
            <ul className="mt-6 grid gap-2">
              {EXAMPLES.map((example) => (
                <li key={example}>
                  <button
                    type="button"
                    onClick={() => send(example)}
                    className={`group flex w-full items-center gap-3 rounded-(--dash-radius) border border-(--dash-line) px-4 py-3 text-left text-sm transition-colors hover:border-(--dash-line-strong) hover:bg-(--dash-tint) ${dashFocus}`}
                  >
                    <span className="flex-1">{example}</span>
                    <ArrowRight
                      className="size-4 shrink-0 text-(--dash-ash) transition-colors group-hover:text-(--dash-fg)"
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className={`${COLUMN} grid gap-6 py-6`}>
            {turns.map((turn, index) =>
              turn.from === "you" ? (
                <p
                  // biome-ignore lint/suspicious/noArrayIndexKey: a transcript is append-only
                  key={index}
                  className="ml-auto max-w-[85%] rounded-(--dash-radius) rounded-br-sm bg-(--dash-fg) px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-line text-(--dash-surface)"
                >
                  {turn.text}
                </p>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: a transcript is append-only
                <div key={index} className="grid gap-3">
                  <Who
                    meta={turn.from === "advisor" ? "answered" : "refused"}
                  />
                  {turn.from === "refused" ? (
                    <ErrorNote>{turn.text}</ErrorNote>
                  ) : (
                    <>
                      <RunBar
                        query={turn.query}
                        rows={turn.rows.length}
                        seconds={turn.seconds}
                        onOpen={() => setShowing(index)}
                      />
                      <p className="text-[15px] leading-relaxed">{turn.text}</p>
                      <Rows caption={turn.caption} rows={turn.rows} />
                    </>
                  )}
                </div>
              ),
            )}

            {ask.isPending ? (
              <div className="grid gap-3">
                <Who meta="thinking…" busy />
                <p className="text-sm text-(--dash-ash)">
                  Choosing which of the six would answer this.
                </p>
              </div>
            ) : null}
            <div ref={bottom} />
          </div>
        )}
      </div>

      {/* Always here, at the bottom, whether or not anything has been asked. */}
      <div className="shrink-0 border-t border-(--dash-line) pt-3">
        <div className={COLUMN}>{composer}</div>
      </div>

      <RunPanel
        open={open?.from === "advisor"}
        onClose={() => setShowing(null)}
        title="How that answer was reached"
        subtitle={
          open?.from === "advisor"
            ? `${open.seconds.toFixed(1)}s · two calls, one query`
            : undefined
        }
      >
        {open?.from === "advisor" ? <RunDetail turn={open} /> : null}
      </RunPanel>
    </div>
  );
}

/** The bar in the transcript that opens the detail. */
function RunBar({
  query,
  rows,
  seconds,
  onOpen,
}: {
  query: string;
  rows: number;
  seconds: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex w-full items-center justify-between gap-3 rounded-(--dash-radius) border border-(--dash-line) bg-(--dash-tint) px-3.5 py-2.5 text-left text-xs transition-colors hover:border-(--dash-line-strong) ${dashFocus}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Check className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">
          Looked at <span className="font-mono">{query}</span> · {rows} row
          {rows === 1 ? "" : "s"}
          <span className="text-(--dash-ash)"> · {seconds.toFixed(1)}s</span>
        </span>
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-(--dash-ash) transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </button>
  );
}

/**
 * What actually happened, in order. Not a reconstruction: every line here
 * is a value the run returned, including the Advisor's own sentence about
 * why it chose that query.
 */
function RunDetail({ turn }: { turn: Extract<Turn, { from: "advisor" }> }) {
  return (
    <div className="grid gap-5">
      <Step n={1} title="You asked">
        <p className="text-sm leading-relaxed">{turn.question}</p>
      </Step>

      <Step n={2} title="It chose one of the six">
        <p className="font-mono text-sm">{turn.query}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-(--dash-ash)">
          “{turn.why}”
        </p>
        <p className="mt-2 text-[11px] text-(--dash-ash)">
          The name came back inside an enum we wrote, then was looked up in a
          Map — nothing it said reaches a query.
        </p>
      </Step>

      <Step n={3} title="We ran it, scoped to you">
        <p className="text-sm">
          {turn.caption} · {turn.rows.length} row
          {turn.rows.length === 1 ? "" : "s"}
        </p>
        <Rows caption={turn.caption} rows={turn.rows} />
      </Step>

      <Step n={4} title="It answered from those rows only">
        <p className="text-sm leading-relaxed">{turn.text}</p>
        <p className="mt-2 text-[11px] text-(--dash-ash)">
          Every figure was checked against the rows before this was shown. One
          it was not given would have thrown the answer away.
        </p>
      </Step>

      <dl className="grid gap-1.5 border-t border-(--dash-line) pt-4 text-[11px]">
        {[
          ["Chose with", turn.pickedBy],
          ["Answered with", turn.model],
          ["Took", `${turn.seconds.toFixed(1)}s`],
          ["Wrote", "nothing — this seat has no write access"],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-(--dash-ash)">{label}</dt>
            <dd className="text-right font-mono break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-2">
      <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-(--dash-ash) uppercase">
        <span className="grid size-5 place-items-center rounded-full border border-(--dash-line-strong) tabular-nums">
          {n}
        </span>
        {title}
      </p>
      <div className="pl-7">{children}</div>
    </section>
  );
}

function Who({ meta, busy = false }: { meta: string; busy?: boolean }) {
  return (
    <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-(--dash-ash) uppercase">
      {busy ? (
        <Loader2 className="size-3 motion-safe:animate-spin" aria-hidden />
      ) : (
        <Sparkles className="size-3" aria-hidden />
      )}
      Advisor
      <span className="font-normal tracking-normal normal-case">· {meta}</span>
    </p>
  );
}

/** The rows the answer was written from, as they were read. */
function Rows({ caption, rows }: { caption: string; rows: Row[] }) {
  if (rows.length === 0)
    return (
      <p className="border-t border-(--dash-line) pt-3 text-sm text-(--dash-ash)">
        {caption}: there were none, and the answer above is written from that.
      </p>
    );
  const columns = Object.keys(rows[0]);
  return (
    <div className="border-t border-(--dash-line) pt-3">
      <p className="text-[11px] font-semibold tracking-[0.14em] text-(--dash-ash) uppercase">
        {caption} · {rows.length} row{rows.length === 1 ? "" : "s"}
      </p>
      {/* A tab stop so the box can be reached by keyboard at all, but not a
          landmark: the same table appears in the transcript and again in the
          detail panel, and two landmarks with one name is worse than none. */}
      <div
        className="mt-2 overflow-x-auto"
        // `group`, not `region`: region is a landmark, and this same table
        // appears twice on the page. group takes a name without claiming one.
        role="group"
        aria-label={caption}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region is a tab stop by WAI-ARIA
        tabIndex={0}
      >
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-[11px] tracking-[0.1em] text-(--dash-ash) uppercase">
              {columns.map((column) => (
                <th key={column} className="py-1.5 pr-4 font-semibold">
                  {column.replaceAll("_", " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: rows as read
                key={index}
                className="border-t border-(--dash-line)"
              >
                {Object.values(row).map((cell, cellIndex) => (
                  <td
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns as read
                    key={cellIndex}
                    className="py-1.5 pr-4 tabular-nums"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

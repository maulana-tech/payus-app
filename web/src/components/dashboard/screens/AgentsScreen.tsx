"use client";

import {
  ArrowRight,
  Check,
  ChevronRight,
  Loader2,
  Paperclip,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatMinor } from "@/features/invoices/money";
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
  | { from: "you"; text: string; attached?: string }
  | {
      from: "advisor";
      text: string;
      question: string;
      source: "ledger" | "table" | "document";
      query: string;
      why: string;
      caption: string;
      rows: Row[];
      seconds: number;
      model: string;
      pickedBy: string;
    }
  | { from: "refused"; text: string }
  | { from: "reconciled"; report: Reconciled };

type Reconciled = {
  name: string;
  matched: number;
  unreadable: number;
  onlyInFile: {
    row: number;
    date: string | null;
    amountMinor: string;
    description: string;
  }[];
  onlyInLedger: {
    date: string;
    amountMinor: string;
    description: string;
  }[];
};

/** The six, in the words someone would actually use. */
const EXAMPLES = [
  "Who still owes me money?",
  "What came in this week?",
  "How much have I set aside for tax?",
  "Has anything been refunded?",
] as const;

const COLUMN = "mx-auto w-full max-w-3xl";
/** 2 MB: a year of bank lines is well under it, a spreadsheet dump is not. */
const MAX_FILE_BYTES = 2_000_000;

/** One shape for both sources, so the transcript cannot tell them apart by
 * accident — only by the label the answer carries. */
function answered(
  reply: {
    answer: string;
    question: string;
    source: "ledger" | "table" | "document";
    query: string;
    why: string;
    caption: string;
    rows: Row[];
    model: string;
    pickedBy: string;
  },
  started: { current: number },
): Turn {
  return {
    from: "advisor",
    text: reply.answer,
    question: reply.question,
    source: reply.source,
    query: reply.query,
    why: reply.why,
    caption: reply.caption,
    rows: reply.rows,
    seconds: (Date.now() - started.current) / 1000,
    model: reply.model,
    pickedBy: reply.pickedBy,
  };
}

export function AgentsScreen() {
  const status = trpc.agents.status.useQuery();
  // Fetched once and left alone: `fresh` already holds this session's turns,
  // so a refetch would show each of them twice until the page reloads.
  const history = trpc.agents.advisorHistory.useQuery(undefined, {
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const forget = trpc.agents.forgetAdvisorHistory.useMutation();
  // What was asked before, plus what has been asked since this page opened.
  const [fresh, setFresh] = useState<Turn[]>([]);
  const kept: Turn[] = (history.data ?? []).flatMap((turn) => [
    { from: "you" as const, text: turn.question },
    {
      from: "advisor" as const,
      text: turn.answer,
      question: turn.question,
      source: turn.source,
      query: turn.query,
      why: turn.why,
      caption: turn.caption,
      rows: turn.rows,
      seconds: turn.seconds,
      model: turn.model,
      pickedBy: turn.pickedBy,
      askedVia: turn.askedVia,
    },
  ]);
  const turns = [...kept, ...fresh];
  const [text, setText] = useState("");
  // A file is attached to the next question only. Nothing is uploaded until
  // something is asked about it, and the bytes never leave this page — only
  // the text does, and only once.
  const [file, setFile] = useState<
    | { kind: "table"; name: string; csv: string }
    | { kind: "document"; name: string; text: string }
    | null
  >(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const started = useRef(0);
  // Which run's detail is open, by its index in the transcript.
  const [showing, setShowing] = useState<number | null>(null);

  const check = trpc.agents.reconcileTable.useMutation({
    onSuccess: (report) =>
      setFresh((t) => [...t, { from: "reconciled", report }]),
    onError: (error) =>
      setFresh((t) => [...t, { from: "refused", text: error.message }]),
  });
  const onDocument = trpc.agents.askAboutDocument.useMutation({
    onSuccess: (reply) => setFresh((t) => [...t, answered(reply, started)]),
    onError: (error) =>
      setFresh((t) => [...t, { from: "refused", text: error.message }]),
  });
  const onTable = trpc.agents.askAboutTable.useMutation({
    onSuccess: (reply) => setFresh((t) => [...t, answered(reply, started)]),
    onError: (error) =>
      setFresh((t) => [...t, { from: "refused", text: error.message }]),
  });
  const ask = trpc.agents.runAdvisor.useMutation({
    onSuccess: (reply) => setFresh((t) => [...t, answered(reply, started)]),
    // A refusal is an answer too — it belongs in the transcript, in order,
    // not in a box above it that the next question wipes.
    onError: (error) =>
      setFresh((t) => [...t, { from: "refused", text: error.message }]),
  });

  const busy =
    ask.isPending ||
    onTable.isPending ||
    onDocument.isPending ||
    check.isPending ||
    reading;

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the tail
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns.length, busy]);

  const send = (question: string) => {
    const q = question.trim();
    if (q.length < 3 || busy) return;
    setFresh((t) => [...t, { from: "you", text: q, attached: file?.name }]);
    setText("");
    started.current = Date.now();
    if (file?.kind === "table") {
      onTable.mutate({ question: q, name: file.name, csv: file.csv });
      setFile(null);
      return;
    }
    if (file?.kind === "document") {
      onDocument.mutate({ question: q, name: file.name, text: file.text });
      setFile(null);
      return;
    }
    ask.mutate({ question: q });
  };

  const attach = async (picked: File) => {
    setFileError("");
    if (picked.size > MAX_FILE_BYTES) {
      setFileError(
        `${picked.name} is ${(picked.size / 1_000_000).toFixed(1)} MB. The limit is 2 MB.`,
      );
      return;
    }
    if (/\.(csv|tsv)$/i.test(picked.name)) {
      setFile({ kind: "table", name: picked.name, csv: await picked.text() });
      return;
    }
    // A PDF and a .docx are read here, in the page. Both are container
    // formats with a long history of parser bugs, and the server has no
    // reason to meet one: it is sent the words and never the file.
    setReading(true);
    try {
      const { extractText } = await import("@/features/uploads/extract");
      const read = await extractText(picked);
      setFile({ kind: "document", name: read.name, text: read.text });
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : "That file could not be read.",
      );
    } finally {
      setReading(false);
    }
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
      // No box: the composer sits in the page rather than on it. A border
      // here drew a second edge inside the one the panel already has, and
      // the rule above it ran the full width of the screen while the
      // composer stopped well short of both sides.
      className="pb-1"
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
        <div className="flex min-w-0 items-center gap-2">
          <input
            ref={picker}
            type="file"
            accept=".csv,.tsv,.pdf,.docx,.txt,.md"
            // The paperclip is the control; this is the mechanism behind it.
            // Named anyway, because a hidden input with no label is still a
            // form element to a screen reader, and out of the tab order so
            // the two are not announced as two separate things to press.
            aria-label="Attach a CSV"
            tabIndex={-1}
            className="sr-only"
            onChange={(event) => {
              const picked = event.target.files?.[0];
              if (picked) void attach(picked);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => picker.current?.click()}
            aria-label="Attach a CSV"
            className={`flex size-8 shrink-0 items-center justify-center rounded-full text-(--dash-ash) transition-colors hover:bg-(--dash-tint) hover:text-(--dash-fg) ${dashFocus}`}
          >
            <Paperclip className="size-4" aria-hidden />
          </button>
          {file ? (
            <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-(--dash-tint) py-1 pr-1 pl-3 text-[11px]">
              <span className="truncate">{file.name}</span>
              {/* Only a table can be put against the books; a contract has
                  nothing to reconcile. */}
              {file.kind === "table" ? (
                <button
                  type="button"
                  onClick={() => {
                    const today = new Date();
                    const from = new Date(today);
                    from.setUTCDate(from.getUTCDate() - 180);
                    setFresh((t) => [
                      ...t,
                      {
                        from: "you",
                        text: "Check this against my books.",
                        attached: file.name,
                      },
                    ]);
                    check.mutate({
                      name: file.name,
                      csv: file.csv,
                      from: from.toISOString().slice(0, 10),
                      to: today.toISOString().slice(0, 10),
                    });
                    setFile(null);
                  }}
                  className={`rounded-full bg-(--dash-fg) px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-(--dash-surface) uppercase ${dashFocus}`}
                >
                  Reconcile
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setFile(null)}
                aria-label={`Remove ${file.name}`}
                className={`flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-(--dash-line-strong) ${dashFocus}`}
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ) : (
            <p className="truncate text-[11px] text-(--dash-ash)">
              {reading
                ? "Reading the document…"
                : "Reads your rows. It has no write access of any kind."}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={busy || text.trim().length < 3}
          className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-(--dash-fg) px-4 text-[13px] font-semibold tracking-[0.08em] text-(--dash-surface) uppercase transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40 ${dashFocus}`}
        >
          {busy ? (
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
        {turns.length === 0 && !busy ? (
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
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: a transcript is append-only
                  key={index}
                  className="ml-auto grid max-w-[85%] justify-items-end gap-1.5"
                >
                  {turn.attached ? (
                    <span className="flex items-center gap-1.5 rounded-full border border-(--dash-line) px-3 py-1 text-[11px] text-(--dash-ash)">
                      <Paperclip className="size-3" aria-hidden />
                      {turn.attached}
                    </span>
                  ) : null}
                  <p className="rounded-(--dash-radius) rounded-br-sm bg-(--dash-fg) px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-line text-(--dash-surface)">
                    {turn.text}
                  </p>
                </div>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: a transcript is append-only
                <div key={index} className="grid gap-3">
                  <Who
                    meta={turn.from === "advisor" ? "answered" : "refused"}
                  />
                  {turn.from === "reconciled" ? (
                    <ReconciledReport report={turn.report} />
                  ) : turn.from === "refused" ? (
                    <ErrorNote>{turn.text}</ErrorNote>
                  ) : (
                    <>
                      <p className="text-[15px] leading-relaxed">{turn.text}</p>
                      {turn.source === "document" ? (
                        <Unchecked name={turn.caption} />
                      ) : (
                        <Rows caption={turn.caption} rows={turn.rows} />
                      )}
                      <RunBar
                        query={turn.query}
                        rows={turn.rows.length}
                        seconds={turn.seconds}
                        onOpen={() => setShowing(index)}
                      />
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
      <div className="shrink-0 pt-2">
        <div className={COLUMN}>
          {fileError ? (
            <p className="mb-2 text-[11px] text-(--dash-err)" role="alert">
              {fileError}
            </p>
          ) : null}
          {composer}
        </div>
      </div>

      {turns.length > 0 ? (
        <div className="shrink-0 pt-2 text-right">
          <button
            type="button"
            disabled={forget.isPending}
            onClick={() => {
              forget.mutate(undefined, {
                onSuccess: () => {
                  setFresh([]);
                  void history.refetch();
                },
              });
            }}
            className={`text-[11px] text-(--dash-ash) underline-offset-2 hover:underline disabled:opacity-40 ${dashFocus}`}
          >
            {forget.isPending ? "Clearing…" : "Clear this transcript"}
          </button>
        </div>
      ) : null}

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

/**
 * The one answer this seat gives that nothing checks.
 *
 * Every other answer is held to its rows — a figure it was not given throws
 * the answer away. A document has no rows, so the model's arithmetic and
 * its reading both stand unverified. That is worth offering and not worth
 * hiding, so it is said on every one of them.
 */
function Unchecked({ name }: { name: string }) {
  return (
    <p className="border-t border-(--dash-line) pt-3 text-sm text-(--dash-ash)">
      Read from <span className="text-(--dash-fg)">{name}</span>. There are no
      rows behind this one, so nothing checked the figures in it — unlike an
      answer from your ledger. Worth reading against the document itself.
    </p>
  );
}

/** The line under an answer that opens the detail behind it. */
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
      // A line, not a bar. Boxing this put a frame around the quietest part
      // of the turn and pushed the answer — the thing being read — further
      // down the page.
      className={`group -mt-1 flex items-center gap-1.5 self-start text-[11px] text-(--dash-ash) transition-colors hover:text-(--dash-fg) ${dashFocus}`}
    >
      <Check className="size-3 shrink-0" aria-hidden />
      <span>
        Looked at <span className="font-mono">{query}</span> · {rows} row
        {rows === 1 ? "" : "s"} · {seconds.toFixed(1)}s
      </span>
      <ChevronRight
        className="size-3 shrink-0 transition-transform group-hover:translate-x-0.5"
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

/**
 * What agreed, and — the part that earns the feature — what did not.
 *
 * The two "only in" lists lead, because a line your bank has and your books
 * do not is exactly what someone opens this to find. A count of matches is
 * reassurance; a named difference is work.
 */
function ReconciledReport({ report }: { report: Reconciled }) {
  const clean =
    report.onlyInFile.length === 0 && report.onlyInLedger.length === 0;
  const sum = (xs: { amountMinor: string }[]) =>
    xs.reduce((total, x) => total + BigInt(x.amountMinor), 0n);
  const fileSide = sum(report.onlyInFile);
  const ledgerSide = sum(report.onlyInLedger);
  const difference = fileSide - ledgerSide;
  return (
    <div className="grid gap-4">
      <p className="text-[15px] leading-relaxed">
        {clean
          ? `Every line in ${report.name} has a posting, and every posting has a line.`
          : `${report.matched} line${report.matched === 1 ? "" : "s"} in ${report.name} ${report.matched === 1 ? "agrees" : "agree"} with your books. The rest are below.`}
        {report.unreadable > 0
          ? ` ${report.unreadable} row${report.unreadable === 1 ? "" : "s"} carried no amount and took no part.`
          : ""}
      </p>

      {!clean && difference === 0n ? (
        // The same money, recorded differently — a statement that lists a
        // sale and its fee separately against books that post the net is
        // the usual cause. Said, not matched: pairing them automatically is
        // how a reconciler starts agreeing with things it should not.
        <p className="rounded-(--dash-radius) border border-(--dash-line) bg-(--dash-tint) p-3 text-sm leading-relaxed">
          The two lists come to the same amount, so these are probably the same
          movements written down differently — a sale and its fee on separate
          lines against one posting of the net, most often.
        </p>
      ) : null}

      <Difference
        title="In the file, not in your books"
        hint="Money your bank saw that nothing here accounts for."
        rows={report.onlyInFile.map((line) => ({
          key: `f${line.row}`,
          left: `row ${line.row}${line.date ? ` · ${line.date}` : ""}`,
          middle: line.description,
          amountMinor: line.amountMinor,
        }))}
      />
      <Difference
        title="In your books, not in the file"
        hint="Posted here, but not seen on the statement — yet, or at all."
        rows={report.onlyInLedger.map((posting, i) => ({
          key: `l${i}`,
          left: posting.date,
          middle: posting.description,
          amountMinor: posting.amountMinor,
        }))}
      />

      {!clean && difference !== 0n ? (
        <p className="border-t border-(--dash-line) pt-3 text-sm text-(--dash-ash)">
          The unmatched lines differ by{" "}
          <span className="tabular-nums text-(--dash-fg)">
            {formatMinor(difference)}
          </span>{" "}
          — the file side less the ledger side.
        </p>
      ) : null}
    </div>
  );
}

function Difference({
  title,
  hint,
  rows,
}: {
  title: string;
  hint: string;
  rows: { key: string; left: string; middle: string; amountMinor: string }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="border-t border-(--dash-line) pt-3">
      <p className="text-[11px] font-semibold tracking-[0.14em] text-(--dash-ash) uppercase">
        {title} · {rows.length}
      </p>
      <p className="mt-1 text-sm text-(--dash-ash)">{hint}</p>
      <ul className="mt-2 grid gap-1.5">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-baseline justify-between gap-4 text-sm"
          >
            <span className="min-w-0">
              <span className="text-(--dash-ash)">{row.left}</span>
              {row.middle ? ` · ${row.middle}` : ""}
            </span>
            <span className="shrink-0 tabular-nums">
              {formatMinor(BigInt(row.amountMinor))}
            </span>
          </li>
        ))}
      </ul>
    </div>
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

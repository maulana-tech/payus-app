"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/react";
import { dashButtonSecondary } from "../styles";
import { ErrorNote, Panel } from "./kit";

// The Advisor. It does not write the query — it picks one of ours and we
// run it — so the rows it read are shown under the answer. An answer whose
// rows you cannot see is a claim, and this seat exists to settle questions,
// not to make them.

export function AskPanel() {
  const status = trpc.agents.status.useQuery();
  const [question, setQuestion] = useState("");
  const ask = trpc.agents.runAdvisor.useMutation();

  if (status.data && !status.data.configured) return null;
  const answer = ask.data;

  return (
    <Panel
      title="Ask"
      hint="The Advisor answers from your own rows. It has no write access of any kind, and it cannot use a figure the rows do not contain."
    >
      <div className="grid gap-4 p-5">
        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            ask.mutate({ question: question.trim() });
          }}
        >
          <Input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Who still owes me money?"
            aria-label="Ask about your money"
            className="min-w-0 flex-1 basis-64"
          />
          <button
            type="submit"
            className={dashButtonSecondary}
            disabled={ask.isPending || question.trim().length < 3}
          >
            {ask.isPending ? "Looking…" : "Ask"}
          </button>
        </form>

        {ask.error ? <ErrorNote>{ask.error.message}</ErrorNote> : null}

        {answer ? (
          <>
            <p className="max-w-2xl text-[15px] leading-relaxed">
              {answer.answer}
            </p>
            <div className="border-t border-(--dash-line) pt-4">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-(--dash-ash) uppercase">
                {answer.caption} · {answer.rows.length} row
                {answer.rows.length === 1 ? "" : "s"}
              </p>
              {answer.rows.length === 0 ? (
                <p className="mt-3 text-sm text-(--dash-ash)">
                  There were none, and the answer above is written from that.
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-[11px] tracking-[0.1em] text-(--dash-ash) uppercase">
                        {Object.keys(answer.rows[0]).map((column) => (
                          <th
                            key={column}
                            className="py-1.5 pr-4 font-semibold"
                          >
                            {column.replaceAll("_", " ")}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {answer.rows.map((row, index) => (
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
              )}
            </div>
          </>
        ) : null}
      </div>
    </Panel>
  );
}

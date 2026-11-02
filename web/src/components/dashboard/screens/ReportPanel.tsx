"use client";

import { useState } from "react";
import { trpc } from "@/trpc/react";
import { dashButtonSecondary } from "../styles";
import { ErrorNote, Panel } from "./kit";

// The Reporter, where its answer belongs: above the numbers it describes.
// The figures it was allowed to use are shown underneath, because a report
// whose sources you cannot see is just a claim.

export function ReportPanel() {
  const status = trpc.agents.status.useQuery();
  const [run, setRun] = useState<{
    report: string;
    figures: Record<string, string>;
  } | null>(null);
  const ask = trpc.agents.runReporter.useMutation({
    onSuccess: (result) => setRun(result),
    onError: () => setRun(null),
  });

  if (status.data && !status.data.configured) return null;

  return (
    <Panel
      title="In words"
      hint="The Reporter is handed the figures and writes the sentences. It cannot state a number it was not given."
      action={
        <button
          type="button"
          className={dashButtonSecondary}
          disabled={ask.isPending}
          onClick={() => ask.mutate()}
        >
          {ask.isPending ? "Writing…" : run ? "Again" : "Ask the Reporter"}
        </button>
      }
    >
      <div className="grid gap-4 p-5">
        {run ? (
          <>
            <p className="max-w-2xl text-[15px] leading-relaxed">
              {run.report}
            </p>
            <div className="border-t border-(--dash-line) pt-4">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-(--dash-ash) uppercase">
                The figures it was given
              </p>
              <dl className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
                {Object.entries(run.figures).map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <dt className="min-w-0 truncate text-(--dash-ash)">
                      {label}
                    </dt>
                    <dd className="shrink-0 tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </>
        ) : (
          <p className="text-sm text-(--dash-ash)">
            A few sentences about what has happened with your money, built from
            the ledger rather than from memory.
          </p>
        )}
        {ask.error ? <ErrorNote>{ask.error.message}</ErrorNote> : null}
      </div>
    </Panel>
  );
}

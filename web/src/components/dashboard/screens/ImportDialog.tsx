"use client";

import { Check, Loader2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/trpc/react";
import { dashButtonPrimary, dashButtonSecondary, dashFocus } from "../styles";
import { ErrorNote } from "./kit";

// Bringing a spreadsheet in.
//
// The order is the point: read, show, then create — and nothing is created
// until the person has seen what would be. An importer that writes first and
// reports afterwards leaves work that is harder to undo than it was to do.

const MAX_FILE_BYTES = 2_000_000;

export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<
    { row: number; number: string; outcome: string; detail?: string }[] | null
  >(null);

  const today = new Date().toISOString().slice(0, 10);
  const preview = trpc.invoices.previewImport.useQuery(
    { csv: file?.csv ?? "", defaultDueDate: today },
    { enabled: Boolean(file), retry: false },
  );
  const commit = trpc.invoices.commitImport.useMutation({
    onSuccess: (result) => {
      setDone(result.results);
      void utils.invoices.list.invalidate();
    },
  });

  const reset = () => {
    setFile(null);
    setError("");
    setDone(null);
    commit.reset();
  };

  const take = async (picked: File) => {
    setError("");
    setDone(null);
    if (picked.size > MAX_FILE_BYTES) {
      setError(`${picked.name} is over the 2 MB limit.`);
      return;
    }
    try {
      const { extractCsv } = await import("@/features/uploads/extract");
      setFile({ name: picked.name, csv: await extractCsv(picked) });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "That file could not be read.",
      );
    }
  };

  const data = preview.data;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        size="lg"
        className="max-h-[90svh] overflow-y-auto sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>Bring invoices in from a file</DialogTitle>
          <DialogDescription>
            A CSV or spreadsheet with a client and an amount per row. You will
            see every row before anything is created, and the ones that cannot
            be made are named rather than dropped.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <Done results={done} onAgain={reset} />
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={picker}
                type="file"
                accept=".csv,.tsv,.xlsx,.txt"
                aria-label="Choose a CSV"
                tabIndex={-1}
                className="sr-only"
                onChange={(event) => {
                  const picked = event.target.files?.[0];
                  if (picked) void take(picked);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className={dashButtonSecondary}
                onClick={() => picker.current?.click()}
              >
                <Upload aria-hidden="true" />
                {file ? "Choose another" : "Choose a file"}
              </button>
              {file ? (
                <span className="flex items-center gap-2 text-sm">
                  {file.name}
                  <button
                    type="button"
                    onClick={reset}
                    aria-label="Remove the file"
                    className={`flex size-6 items-center justify-center rounded-full hover:bg-(--dash-tint) ${dashFocus}`}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </span>
              ) : null}
            </div>

            {error ? <ErrorNote>{error}</ErrorNote> : null}
            {preview.error ? (
              <ErrorNote>{preview.error.message}</ErrorNote>
            ) : null}
            {commit.error ? (
              <ErrorNote>{commit.error.message}</ErrorNote>
            ) : null}

            {preview.isFetching ? (
              <p className="text-sm text-(--dash-ash)">Reading…</p>
            ) : null}

            {data ? (
              <>
                <p className="text-sm">
                  <span className="font-medium">{data.ready}</span> row
                  {data.ready === 1 ? "" : "s"} ready
                  {data.skipped > 0 ? (
                    <>
                      , <span className="font-medium">{data.skipped}</span> that
                      cannot be made
                    </>
                  ) : null}
                  . Read as:{" "}
                  <span className="text-(--dash-ash)">
                    {[
                      ["client", data.mapping.clientName],
                      ["amount", data.mapping.amount],
                      ["due", data.mapping.dueDate],
                      ["number", data.mapping.number],
                    ]
                      .filter(([, column]) => column)
                      .map(([what, column]) => `${what} = ${column}`)
                      .join(" · ")}
                  </span>
                </p>

                <div className="max-h-80 overflow-y-auto rounded-(--dash-radius) border border-(--dash-line)">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-(--dash-surface)">
                      <tr className="text-[11px] tracking-[0.1em] text-(--dash-ash) uppercase">
                        {["row", "number", "client", "due", "amount", ""].map(
                          (head) => (
                            <th
                              key={head || "state"}
                              className="border-b border-(--dash-line) px-3 py-2 font-semibold"
                            >
                              {head}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row) => (
                        <tr
                          key={row.row}
                          className="border-t border-(--dash-line)"
                        >
                          <td className="px-3 py-1.5 text-(--dash-ash) tabular-nums">
                            {row.row}
                          </td>
                          <td className="px-3 py-1.5">{row.number}</td>
                          <td className="px-3 py-1.5">{row.clientName}</td>
                          <td className="px-3 py-1.5 tabular-nums">
                            {row.dueDate}
                          </td>
                          <td className="px-3 py-1.5 tabular-nums">
                            {row.amount}
                          </td>
                          <td className="px-3 py-1.5">
                            {row.ok ? (
                              <Check
                                className="size-4"
                                aria-label="Will be created"
                              />
                            ) : (
                              <span className="text-(--dash-err)">
                                {row.problem}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {data.truncated.rows > 0 ? (
                  <p className="text-sm text-(--dash-ash)">
                    Only the first rows were read; {data.truncated.rows} more
                    are in the file.
                  </p>
                ) : null}

                <div className="flex justify-end">
                  <button
                    type="button"
                    className={dashButtonPrimary}
                    disabled={data.ready === 0 || commit.isPending || !file}
                    onClick={() =>
                      file &&
                      commit.mutate({ csv: file.csv, defaultDueDate: today })
                    }
                  >
                    {commit.isPending ? (
                      <Loader2
                        className="size-4 motion-safe:animate-spin"
                        aria-hidden="true"
                      />
                    ) : null}
                    Create {data.ready} invoice{data.ready === 1 ? "" : "s"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** What happened, row by row — including the ones that were already here. */
function Done({
  results,
  onAgain,
}: {
  results: { row: number; number: string; outcome: string; detail?: string }[];
  onAgain: () => void;
}) {
  const created = results.filter((r) => r.outcome === "created").length;
  const already = results.filter((r) => r.outcome === "already here").length;
  const refused = results.filter((r) => r.outcome === "refused");
  return (
    <div className="grid gap-4">
      <p className="text-sm">
        <span className="font-medium">{created}</span> created
        {already > 0 ? (
          <>
            , <span className="font-medium">{already}</span> were already here
          </>
        ) : null}
        {refused.length > 0 ? (
          <>
            , <span className="font-medium">{refused.length}</span> refused
          </>
        ) : null}
        .
      </p>
      {already > 0 ? (
        <p className="text-sm text-(--dash-ash)">
          An invoice number can only be used once, so importing the same file
          again reports rather than duplicates.
        </p>
      ) : null}
      {refused.length > 0 ? (
        <ul className="grid gap-1 text-sm">
          {refused.map((r) => (
            <li key={r.row}>
              <span className="text-(--dash-ash)">row {r.row}</span> ·{" "}
              {r.number} — {r.detail ?? "refused"}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex justify-end">
        <button type="button" className={dashButtonSecondary} onClick={onAgain}>
          Import another
        </button>
      </div>
    </div>
  );
}

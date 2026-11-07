"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { linenInsetClass } from "../ui/glass";

// One vocabulary for every choice onboarding asks for: a numbered card that
// explains the option in a sentence, then answers the two questions people
// actually have about it. No badges, no decoration — the card is the type.

export type CardRow = { label: string; value: string };

export function ChoiceCard({
  index,
  title,
  note,
  summary,
  rows,
  selected = false,
  disabled = false,
  pick = true,
  onSelect,
}: {
  /** Shown as 01, 02, 03 down the left. */
  index: number;
  title: string;
  /** A short qualifier beside the title, e.g. "Recommended". */
  note?: string;
  summary: ReactNode;
  rows?: CardRow[];
  selected?: boolean;
  disabled?: boolean;
  /**
   * True when the card is one of several to choose between and a Continue
   * follows (a radio); false when clicking it acts straight away.
   */
  pick?: boolean;
  onSelect: () => void;
}) {
  const body = (
    <>
      <span className="flex items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold tracking-[0.18em] text-foreground/70 tabular-nums">
            {String(index).padStart(2, "0")}
          </span>
          <span className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
            <span className="text-[17px] leading-tight font-semibold text-foreground">
              {title}
            </span>
            {note ? (
              <span className="text-[11px] font-semibold tracking-[0.14em] text-foreground/70 uppercase">
                {note}
              </span>
            ) : null}
          </span>
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
            selected ? "border-foreground" : "border-foreground/25",
          )}
        >
          <span
            className={cn(
              "size-2.5 rounded-full bg-foreground transition-opacity",
              selected ? "opacity-100" : "opacity-0",
            )}
          />
        </span>
      </span>

      <span className="block text-[13px] leading-6 text-foreground/70">
        {summary}
      </span>

      {rows?.length ? (
        <span className="grid gap-2.5 border-t border-foreground/12 pt-3">
          {rows.map((row) => (
            // Label above value, not beside it: in a column one third of the
            // dialog wide, a 5.5rem label column left the answer too narrow
            // to read.
            <span key={row.label} className="grid gap-0.5">
              <span className="text-[10px] font-semibold tracking-[0.16em] text-foreground/70 uppercase">
                {row.label}
              </span>
              <span className="text-[13px] leading-5 text-foreground/75">
                {row.value}
              </span>
            </span>
          ))}
        </span>
      ) : null}
    </>
  );

  const className = cn(
    linenInsetClass,
    "grid w-full gap-3 border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-foreground/70 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:p-5",
    selected
      ? "border-foreground/60"
      : "border-foreground/18 hover:border-foreground/35",
  );

  // Two shapes rather than one with a computed role: a radio waits for the
  // Continue beneath it, a plain button has already acted by then.
  return pick ? (
    // biome-ignore lint/a11y/useSemanticElements: a card-sized radio
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={className}
    >
      {body}
    </button>
  ) : (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={className}
    >
      {body}
    </button>
  );
}

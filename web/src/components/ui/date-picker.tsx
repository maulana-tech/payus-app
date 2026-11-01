"use client";

import { Popover } from "@base-ui/react/popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { linenFieldClass } from "./glass";

// Dates are "YYYY-MM-DD" strings, like a native date input's value, and all
// arithmetic runs in UTC so a time zone never shifts a day.

const MONTH = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const SHORT_MONTH = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});
const DISPLAY = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const SPOKEN = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const WEEKDAYS = [
  ["Mo", "Monday"],
  ["Tu", "Tuesday"],
  ["We", "Wednesday"],
  ["Th", "Thursday"],
  ["Fr", "Friday"],
  ["Sa", "Saturday"],
  ["Su", "Sunday"],
] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtc(iso: string): Date | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

const isoOf = (d: Date) => d.toISOString().slice(0, 10);

function addDays(iso: string, days: number): string {
  const d = toUtc(iso) ?? new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return isoOf(d);
}

/** Same day of another month, clamped to that month's length. */
function addMonths(iso: string, months: number): string {
  const d = toUtc(iso) ?? new Date();
  const target = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1),
  );
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return isoOf(target);
}

function localToday(): string {
  const now = new Date();
  return isoOf(
    new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())),
  );
}

/** 42 days (six Monday-first weeks) covering the month of `iso`. */
function monthGrid(iso: string): string[] {
  const d = toUtc(iso) ?? new Date();
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const start = isoOf(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i - lead));
}

const clamp = (iso: string, min?: string, max?: string) =>
  min && iso < min ? min : max && iso > max ? max : iso;

export function formatDisplayDate(iso: string): string {
  const d = toUtc(iso);
  return d ? DISPLAY.format(d) : "";
}

/**
 * A calendar popover in place of <input type="date">. Arrow keys move by day
 * and week, Page Up/Down by month, Home/End to the week's ends.
 */
export function DatePicker({
  value,
  onChange,
  min,
  max,
  id,
  placeholder = "Pick a date",
  clearable = false,
  disabled,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  id?: string;
  placeholder?: string;
  /** Offer "Clear" (empty string), for optional filters. */
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"days" | "months">("days");
  // The keyboard-focused day; its month is the one on screen.
  const [focus, setFocus] = useState(() =>
    clamp(value || localToday(), min, max),
  );
  const moveFocus = useRef(false);
  const grid = useRef<HTMLTableElement>(null);
  const today = localToday();
  const selected = toUtc(value) ? value : "";

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-date="${focus}"]`)?.focus();
  }, [focus]);

  const outOfRange = (iso: string) =>
    Boolean((min && iso < min) || (max && iso > max));

  function choose(iso: string) {
    if (outOfRange(iso)) return;
    onChange(iso);
    setOpen(false);
  }

  function onDayKey(e: KeyboardEvent) {
    const step: Record<string, () => string> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focus, e.shiftKey ? 12 : 1),
      Home: () => addDays(focus, -(((toUtc(focus)?.getUTCDay() ?? 1) + 6) % 7)),
      End: () =>
        addDays(focus, 6 - (((toUtc(focus)?.getUTCDay() ?? 1) + 6) % 7)),
    };
    const next = step[e.key];
    if (!next) return;
    e.preventDefault();
    moveFocus.current = true;
    setFocus(next());
  }

  const shown = toUtc(focus) ?? new Date();
  const month = shown.getUTCMonth();
  const year = shown.getUTCFullYear();
  const days = monthGrid(focus);
  const monthStart = (y: number, m: number) =>
    isoOf(new Date(Date.UTC(y, m, 1)));
  const monthEnd = (y: number, m: number) =>
    isoOf(new Date(Date.UTC(y, m + 1, 0)));
  const prevDisabled = Boolean(
    min &&
      (view === "days"
        ? monthEnd(year, month - 1) < min
        : monthEnd(year - 1, 11) < min),
  );
  const nextDisabled = Boolean(
    max &&
      (view === "days"
        ? monthStart(year, month + 1) > max
        : monthStart(year + 1, 0) > max),
  );
  const navButton =
    "flex size-9 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30";

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setView("days");
          setFocus(clamp(selected || today, min, max));
        }
      }}
    >
      <Popover.Trigger
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-haspopup="dialog"
        className={cn(
          linenFieldClass,
          "group flex h-10 w-full min-w-0 items-center gap-2.5 border px-3 text-left text-base transition-colors outline-none hover:border-foreground/30 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 data-popup-open:border-foreground/40 md:text-sm",
          className,
        )}
      >
        <CalendarDays
          className="size-4 shrink-0 text-foreground/55"
          aria-hidden="true"
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate tabular-nums",
            !selected && "text-foreground/45",
          )}
        >
          {selected ? formatDisplayDate(selected) : placeholder}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="isolate z-50 outline-none"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
        >
          <Popover.Popup
            initialFocus={() =>
              grid.current?.querySelector<HTMLElement>('[tabindex="0"]') ?? true
            }
            className="w-[19.5rem] origin-(--transform-origin) rounded-xl bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-border outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none"
          >
            <div className="flex items-center justify-between gap-2 pb-2">
              <button
                type="button"
                className={navButton}
                disabled={prevDisabled}
                aria-label={
                  view === "days" ? "Previous month" : "Previous year"
                }
                onClick={() =>
                  setFocus((f) => addMonths(f, view === "days" ? -1 : -12))
                }
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="h-9 rounded-full px-3 text-sm font-semibold transition-colors hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                aria-label={
                  view === "days"
                    ? `${MONTH.format(shown)}, choose a month`
                    : `${year}, back to days`
                }
                onClick={() =>
                  setView((v) => (v === "days" ? "months" : "days"))
                }
              >
                {view === "days" ? MONTH.format(shown) : year}
              </button>
              <button
                type="button"
                className={navButton}
                disabled={nextDisabled}
                aria-label={view === "days" ? "Next month" : "Next year"}
                onClick={() =>
                  setFocus((f) => addMonths(f, view === "days" ? 1 : 12))
                }
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>
            </div>

            {view === "days" ? (
              <table
                ref={grid}
                aria-label={MONTH.format(shown)}
                className="w-full table-fixed border-collapse"
              >
                <thead>
                  <tr>
                    {WEEKDAYS.map(([short, long]) => (
                      <th
                        key={short}
                        scope="col"
                        abbr={long}
                        className="h-8 text-center text-[11px] font-semibold tracking-[0.06em] text-foreground/50 uppercase"
                      >
                        {short}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 6 }, (_, row) => (
                    <tr key={days[row * 7]}>
                      {days.slice(row * 7, row * 7 + 7).map((iso) => {
                        const d = toUtc(iso) as Date;
                        const inMonth = d.getUTCMonth() === month;
                        const isSelected = iso === selected;
                        const isToday = iso === today;
                        const blocked = outOfRange(iso);
                        return (
                          <td key={iso} className="p-0 py-0.5 text-center">
                            <button
                              type="button"
                              data-date={iso}
                              tabIndex={iso === focus ? 0 : -1}
                              aria-label={SPOKEN.format(d)}
                              aria-pressed={isSelected}
                              aria-current={isToday ? "date" : undefined}
                              aria-disabled={blocked || undefined}
                              onClick={() => choose(iso)}
                              onKeyDown={onDayKey}
                              className={cn(
                                "mx-auto grid size-10 place-items-center rounded-full text-sm tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                inMonth
                                  ? "text-foreground"
                                  : "text-foreground/35",
                                !isSelected &&
                                  !blocked &&
                                  "hover:bg-foreground/8",
                                isToday &&
                                  !isSelected &&
                                  "font-semibold ring-1 ring-foreground/25",
                                isSelected &&
                                  "bg-foreground font-semibold text-background",
                                blocked &&
                                  "cursor-not-allowed text-foreground/20 line-through",
                              )}
                            >
                              {d.getUTCDate()}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="grid grid-cols-3 gap-1.5 py-1">
                {Array.from({ length: 12 }, (_, m) => {
                  const start = monthStart(year, m);
                  const blocked = Boolean(
                    (min && monthEnd(year, m) < min) || (max && start > max),
                  );
                  const current = m === month;
                  return (
                    <button
                      key={start}
                      type="button"
                      disabled={blocked}
                      onClick={() => {
                        setFocus(clamp(addMonths(focus, m - month), min, max));
                        setView("days");
                      }}
                      className={cn(
                        "h-11 rounded-full text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30",
                        current
                          ? "bg-foreground font-semibold text-background"
                          : "hover:bg-foreground/8",
                      )}
                    >
                      {SHORT_MONTH.format(toUtc(start) as Date)}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
              <button
                type="button"
                className="h-9 rounded-full px-3 text-xs font-semibold tracking-[0.08em] uppercase transition-colors hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-30"
                disabled={outOfRange(today)}
                onClick={() => choose(today)}
              >
                Today
              </button>
              {clearable && selected ? (
                <button
                  type="button"
                  className="h-9 rounded-full px-3 text-xs font-semibold tracking-[0.08em] text-foreground/70 uppercase transition-colors hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

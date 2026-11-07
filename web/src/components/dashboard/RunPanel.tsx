"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { dashFocus } from "./styles";

// A panel that comes in from the right, for the detail behind something on
// the page rather than a decision about it. A dialog would be wrong here:
// this does not interrupt, it does not ask anything, and what it covers is
// still worth seeing — so it takes a side of the screen and leaves the rest.

export function RunPanel({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Dimmed, not hidden: the answer behind this is the thing the detail
          is about, and covering it entirely would lose the comparison. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-(--dash-fg)/20 transition-opacity duration-200 motion-reduce:transition-none ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        aria-hidden={!open}
        // aria-hidden alone leaves the close button in the tab order while
        // the panel is off-screen — a stop a keyboard user lands on and
        // cannot see. `inert` takes the whole subtree out of both.
        inert={!open}
        aria-label={title}
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-(--dash-line-strong) bg-(--dash-surface) transition-transform duration-200 motion-reduce:transition-none ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-(--dash-line) px-5 py-4">
          <div className="min-w-0">
            <h2 className="dashboard-tile-title">{title}</h2>
            {subtitle ? (
              <p className="mt-1 text-sm text-(--dash-ash)">{subtitle}</p>
            ) : null}
          </div>
          <button
            ref={close}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`flex size-9 shrink-0 items-center justify-center rounded-full text-(--dash-ash) transition-colors hover:bg-(--dash-tint) hover:text-(--dash-fg) ${dashFocus}`}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </aside>
    </>
  );
}

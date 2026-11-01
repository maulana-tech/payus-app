import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Building blocks for the landing's product mocks: decorative copies of real
// Payus screens, drawn in the landing palette (paper, ink, signal blue).

export function MockWindow({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border border-starlight/15 bg-void-2", className)}>
      <div className="flex items-center gap-2 border-b border-starlight/10 px-4 py-3">
        <span className="size-2.5 rounded-full bg-starlight/20" />
        <span className="size-2.5 rounded-full bg-starlight/20" />
        <span className="size-2.5 rounded-full bg-starlight/20" />
        <span className="ml-2 truncate font-landing-mono text-[11px] text-starlight/50">
          {title}
        </span>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </div>
  );
}

const mockButton =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 bg-indigo-glow px-4 text-sm font-medium text-white transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-40";
const mockGhostButton =
  "inline-flex min-h-11 items-center justify-center gap-2 border border-starlight/20 px-4 text-sm text-starlight transition-colors hover:border-starlight/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet";

type MockButtonProps = ComponentProps<"button"> & {
  /** Drawn like a button but inert: part of the picture, not the demo. */
  decorative?: boolean;
};

/** Solid ink button inside a mock (paper text, so it reads on ink). */
export function MockButton({
  className,
  children,
  decorative,
  ...props
}: MockButtonProps) {
  if (decorative)
    return (
      <span className={cn(mockButton, "hover:opacity-100", className)}>
        {children}
      </span>
    );
  return (
    <button type="button" className={cn(mockButton, className)} {...props}>
      {children}
    </button>
  );
}

/** Outline button inside a mock. */
export function MockGhostButton({
  className,
  children,
  decorative,
  ...props
}: MockButtonProps) {
  if (decorative)
    return (
      <span
        className={cn(mockGhostButton, "hover:border-starlight/20", className)}
      >
        {children}
      </span>
    );
  return (
    <button type="button" className={cn(mockGhostButton, className)} {...props}>
      {children}
    </button>
  );
}

/** Small status pill: "Paid" in signal ink, anything else muted. */
export function StatusChip({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "done";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs",
        tone === "done"
          ? "border-(color:--signal-ink)/40 bg-violet/10 text-(--signal-ink)"
          : "border-starlight/15 text-starlight/60",
      )}
    >
      {children}
    </span>
  );
}

/** One label/value line in a mock (amounts, fees, recipients). */
export function MockRow({
  label,
  value,
  accent = false,
}: {
  label: ReactNode;
  value: ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border px-3.5 py-2.5 text-sm",
        accent
          ? "border-violet/50 bg-violet/10"
          : "border-starlight/10 bg-void/60",
      )}
    >
      <span className="text-starlight/60">{label}</span>
      <span className="flex items-center gap-1.5 text-right text-starlight">
        {value}
      </span>
    </div>
  );
}

/** Decorative QR-style grid (not a scannable code). */
export function FauxQr({
  seed = 7,
  className,
}: {
  seed?: number;
  className?: string;
}) {
  const size = 17;
  const cells: { x: number; y: number }[] = [];
  let state = seed;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      const inFinder =
        (x < 5 && y < 5) || (x > size - 6 && y < 5) || (x < 5 && y > size - 6);
      if (!inFinder && state % 3 === 0) cells.push({ x, y });
    }
  }
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect
        x={x + 0.5}
        y={y + 0.5}
        width="4"
        height="4"
        rx="0.8"
        fill="none"
        stroke="currentColor"
      />
      <rect
        x={x + 1.5}
        y={y + 1.5}
        width="2"
        height="2"
        rx="0.4"
        fill="currentColor"
      />
    </g>
  );
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={cn("size-28 text-starlight", className)}
      aria-hidden="true"
    >
      {cells.map((c) => (
        <rect
          key={`${c.x}-${c.y}`}
          x={c.x + 0.1}
          y={c.y + 0.1}
          width="0.8"
          height="0.8"
          rx="0.2"
          fill="currentColor"
        />
      ))}
      {finder(0, 0)}
      {finder(size - 5, 0)}
      {finder(0, size - 5)}
    </svg>
  );
}

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Flat section background (paper). Kept as a component so sections that
 * layered the old nebula keep their stacking without a gradient. */
export function Nebula({
  variant = "dark",
  className,
}: {
  variant?: "dark" | "light";
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0",
        variant === "dark" ? "bg-void" : "bg-mist",
        className,
      )}
    />
  );
}

const pillBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 text-[13px] font-semibold uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

export const pillOutlineDark = cn(
  pillBase,
  "border border-starlight/70 text-starlight hover:bg-starlight hover:text-void focus-visible:ring-starlight focus-visible:ring-offset-void",
);

export const pillOutlineLight = cn(
  pillBase,
  "border border-graphite/80 text-graphite hover:bg-graphite hover:text-mist focus-visible:ring-graphite focus-visible:ring-offset-mist",
);

export const pillSolidViolet = cn(
  pillBase,
  "bg-indigo-glow text-white hover:opacity-85 focus-visible:ring-violet focus-visible:ring-offset-void",
);

/** Small uppercase tracked label (the "label-data" voice), e.g. "HOW IT WORKS". */
export function MonoLabel({
  children,
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "text-xs font-medium uppercase tracking-[0.12em]",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/** Solid paper panel for dense content (tables, code, mocks) over the dither. */
export const panel = "border border-starlight/10 bg-void-2";

/** Segmented control: a row of options where one is pressed/selected. */
export const segmentGroup =
  "inline-flex flex-wrap gap-1 rounded-[1.5rem] border border-starlight/15 bg-void-2 p-1";
export const segmentButton =
  "inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm text-starlight/70 transition-colors hover:text-starlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet aria-selected:bg-starlight aria-selected:text-void aria-pressed:bg-starlight aria-pressed:text-void";

/**
 * Section opener: tracked label, title, and an intro that sits beside the
 * title on wide screens. `titleId` names the section (aria-labelledby).
 */
export function SectionIntro({
  label,
  title,
  titleId,
  children,
  className,
}: {
  label: string;
  title: ReactNode;
  titleId: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-6 lg:grid-cols-2", className)}>
      <div>
        <MonoLabel className="text-starlight/60">{label}</MonoLabel>
        <h2
          id={titleId}
          className="mt-4 max-w-[22ch] text-[clamp(1.9rem,3vw,2.8rem)] font-normal leading-[1.1] tracking-tight"
        >
          {title}
        </h2>
      </div>
      {children ? (
        <div className="max-w-[48ch] self-end text-lg leading-relaxed text-starlight/75 lg:justify-self-end">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Content width + hairline frame shared by every section. */
export function Frame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[1440px] px-4 sm:px-8 lg:px-14",
        className,
      )}
    >
      {children}
    </div>
  );
}

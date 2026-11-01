import { cn } from "../../lib/utils";
import { dashFocus } from "./styles";

export type SegmentOption<V extends string> = {
  value: V;
  label: string;
  disabled?: boolean;
  title?: string;
};

/**
 * A pill of two to four choices, all visible at once: for short lists where a
 * dropdown would hide the options (same look as the POS unit switch).
 */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: {
  value: V;
  onChange: (value: V) => void;
  options: readonly SegmentOption<V>[];
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <fieldset
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={cn(
        "m-0 flex h-10 w-full min-w-0 gap-1 rounded-full border border-(--dash-line-strong) p-1",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-full min-w-0 flex-1 truncate rounded-full px-3 text-xs font-semibold tracking-[0.06em] whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              dashFocus,
              active
                ? "bg-(--dash-fg) text-(--dash-surface)"
                : "text-(--dash-ash) hover:bg-(--dash-tint) hover:text-(--dash-fg)",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </fieldset>
  );
}

import { cn } from "@/lib/utils";

// Onboarding is three questions in a row. The rail at the top of each dialog
// names all three, not just the one on screen: the labels used to exist in
// this file and never be rendered, so what a person saw was three anonymous
// dashes and "Step 2 of 3" — the count without the scope. Knowing that the
// last question is "how you'll use it" is what makes the first two feel
// finite rather than open-ended.

export const ONBOARDING_STEPS = [
  "How you unlock",
  "Your username",
  "How you'll use it",
] as const;

export type OnboardingStepNumber = 1 | 2 | 3;

export function OnboardingStep({ step }: { step: OnboardingStepNumber }) {
  return (
    <div className="grid gap-2">
      <p className="text-[10px] font-semibold tracking-[0.18em] text-foreground/70 uppercase">
        Step {step} of {ONBOARDING_STEPS.length}
      </p>

      {/* One track, not three loose marks. The bars used to be 1px hairlines
          separated by the gap between their labels, which read as three
          unrelated rules; and below `sm` only the current one was rendered,
          so a phone showed no progress at all — the count in words was the
          only clue left. The track now survives every width. */}
      <ol aria-label="Onboarding steps" className="grid grid-cols-3 gap-1.5">
        {ONBOARDING_STEPS.map((label, i) => {
          const position = i + 1;
          const reached = position <= step;
          const current = position === step;
          return (
            <li
              key={label}
              aria-current={current ? "step" : undefined}
              className="grid gap-1.5"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "block h-1 rounded-full transition-colors",
                  reached ? "bg-foreground" : "bg-foreground/25",
                )}
              />
              {/* A column is about 110px on a phone, not enough for "How
                  you'll use it", so there the names are read out but not
                  drawn — the one being answered is printed under the whole
                  track instead, where it has the width to sit straight. */}
              <span
                className={cn(
                  "sr-only text-[11px] leading-tight tracking-[0.1em] sm:not-sr-only sm:block",
                  current
                    ? "font-semibold text-foreground"
                    : "text-foreground/70",
                )}
              >
                {label}
                {current ? <span className="sr-only"> (this step)</span> : null}
                {reached && !current ? (
                  <span className="sr-only"> (done)</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      {/* aria-hidden: the list above already names this step to a reader. */}
      <p
        aria-hidden="true"
        className="text-[11px] font-semibold tracking-[0.1em] text-foreground sm:hidden"
      >
        {ONBOARDING_STEPS[step - 1]}
      </p>
    </div>
  );
}

/**
 * What is already settled, shown on the steps that follow it. Onboarding
 * cannot offer a Back button honestly — a claimed username and a wrapped PIN
 * are both already on the server — so it shows the decisions instead of
 * pretending they can be walked back.
 */
export function OnboardingSettled({
  items,
}: {
  items: readonly { label: string; value: string }[];
}) {
  if (items.length === 0) return null;
  return (
    // The same measure the dialog gives its description (400px): in the wide
    // step-3 dialog an unconstrained list stretched the full 848px while the
    // paragraph above it stopped less than half way, which read as a mistake.
    <dl className="grid max-w-md gap-1.5 border-t border-foreground/12 pt-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-3"
        >
          <dt className="text-[10px] font-semibold tracking-[0.16em] text-foreground/70 uppercase">
            {item.label}
          </dt>
          <dd className="text-[13px] leading-5 text-foreground/75">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

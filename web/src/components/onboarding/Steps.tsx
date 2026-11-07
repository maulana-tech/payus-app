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
      <ol className="flex flex-wrap gap-x-4 gap-y-2">
        {ONBOARDING_STEPS.map((label, i) => {
          const position = i + 1;
          const done = position < step;
          const current = position === step;
          return (
            <li
              key={label}
              // The step on screen is the only one that has to fit a phone;
              // the rest are context and may fall away. No opacity on the
              // row: dimming a container multiplies with the label's own
              // colour, and two 60% labels inside a 70% row measured 3:1.
              className={cn("grid gap-1.5", current ? "" : "hidden sm:grid")}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "block h-px w-14",
                  done || current ? "bg-foreground" : "bg-foreground/30",
                )}
              />
              {/* State is carried by the rule above and the weight here, not
                  by fading the words — every label stays at 5.9:1 or better. */}
              <span
                className={cn(
                  "text-[11px] tracking-[0.1em]",
                  current
                    ? "font-semibold text-foreground"
                    : "text-foreground/70",
                )}
              >
                {label}
                {current ? <span className="sr-only"> (this step)</span> : null}
                {done ? <span className="sr-only"> (done)</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
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

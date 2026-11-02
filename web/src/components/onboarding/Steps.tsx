import { cn } from "@/lib/utils";

// Onboarding is three questions in a row. Each dialog says which one it is,
// so the flow reads as a sequence rather than three unrelated interruptions.

export const ONBOARDING_STEPS = [
  "How you unlock",
  "Your username",
  "How you'll use it",
] as const;

export function OnboardingStep({ step }: { step: 1 | 2 | 3 }) {
  return (
    <p className="flex items-center gap-3 text-[10px] font-semibold tracking-[0.18em] text-foreground/45 uppercase">
      <span className="flex gap-1" aria-hidden="true">
        {ONBOARDING_STEPS.map((label, i) => (
          <span
            key={label}
            className={cn(
              "h-px w-5 bg-foreground transition-opacity",
              i < step ? "opacity-70" : "opacity-20",
            )}
          />
        ))}
      </span>
      Step {step} of {ONBOARDING_STEPS.length}
    </p>
  );
}

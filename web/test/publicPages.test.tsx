// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The public pages render on the dashboard's shell, where the foreground is
// light in dark mode. `--color-ink` is near-black, so an `ink` text class
// there is invisible — which is how it shipped once. This keeps it out.

const PANELS = [
  "src/components/invoices/InvoicePanel.tsx",
  "src/components/pay/PayPanel.tsx",
  "src/components/storefront/StorefrontPanel.tsx",
  "src/features/payments/PayPalButton.tsx",
];

describe("public pages", () => {
  it.each(PANELS)("colours %s with tokens that follow the mode", (file) => {
    const source = readFileSync(file, "utf8");
    // `text-ink/60` and friends are fixed near-black: invisible on the dark
    // shell these pages are rendered inside.
    expect(source).not.toMatch(/\b(text|bg|border)-ink\//);
    expect(source).not.toMatch(/--color-err/);
  });
});

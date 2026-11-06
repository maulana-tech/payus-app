// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Ledger, ListRow, Panel } from "@/components/dashboard/screens/kit";

// One panel used to decide the width of every other panel on the screen.
//
// Grid and flex items default to `min-width: auto`, which resolves to their
// min-content width — and `truncate` is `white-space: nowrap`, whose
// min-content width is the whole untruncated string. A single long meta line
// ("demo@example.com · Above the $200.00 you asked to approve by hand…")
// therefore measured 574px, pushed the grid track to 616px on a 390px phone,
// and `.dashboard-app`'s `overflow-x-clip` silently cut 226px off the right
// of the page — the money column included. Nothing scrolled; it was simply
// gone.
//
// These assertions guard the three places that now stop it.

const css = readFileSync(resolve(__dirname, "../src/app/globals.css"), "utf8");

describe("a panel cannot widen the screen", () => {
  it("gives every ledger cell a zero minimum width, whatever wraps it", () => {
    expect(css).toMatch(/\.dash-ledger > \*\s*\{\s*min-width:\s*0;/);
  });

  it("gives the panel itself a zero minimum width", () => {
    const { container } = render(
      <Panel title="Waiting for you" hint="…">
        <p>body</p>
      </Panel>,
    );
    expect(container.querySelector("section")?.className).toContain("min-w-0");
  });

  it("lets a row's title, actions and ledger all shrink", () => {
    const { container } = render(
      <Ledger>
        <ListRow
          title={<span>Release $450.00</span>}
          meta="demo@example.com · Above the $200.00 you asked to approve by hand · expires 10:30:16"
          actions={<button type="button">Approve</button>}
        />
      </Ledger>,
    );
    const ledger = container.querySelector(".dash-ledger");
    expect(ledger?.className).toContain("min-w-0");

    // The meta line still truncates — that is the point of the ellipsis —
    // but its ancestors are free to shrink around it.
    const meta = container.querySelector("p.truncate");
    expect(meta).not.toBeNull();
    expect(meta?.parentElement?.className).toContain("min-w-0");

    const actions = container.querySelector("div.justify-end");
    expect(actions?.className).toContain("min-w-0");
  });
});

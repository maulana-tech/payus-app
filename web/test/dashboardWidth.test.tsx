// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { Trash2 } from "lucide-react";
import { describe, expect, it } from "vitest";
import {
  Ledger,
  ListRow,
  Panel,
  RowMenu,
  RowMenuItem,
} from "@/components/dashboard/screens/kit";

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

// Rows carried four or five pills of equal weight. The destructive one was
// an unlabelled bin between two words, and every row was a different width,
// so the amounts beside them never lined up.
describe("a row has one pill and one menu", () => {
  it("reserves the width a list declares, so the amounts share an edge", () => {
    const { container } = render(
      <Ledger style={{ "--row-actions": "12.5rem" } as React.CSSProperties}>
        <ListRow
          title={<span>INV-001</span>}
          trailing={<span>$1,500.00</span>}
          actions={<button type="button">Mark paid</button>}
        />
      </Ledger>,
    );
    const ledger = container.querySelector<HTMLElement>(".dash-ledger");
    expect(ledger?.style.getPropertyValue("--row-actions")).toBe("12.5rem");
    expect(container.querySelector("div.justify-end")?.className).toContain(
      "sm:w-[var(--row-actions,auto)]",
    );
  });

  it("names the menu, because the icon says nothing on its own", () => {
    const { getByLabelText } = render(
      <RowMenu label="More for INV-001">
        <RowMenuItem icon={Trash2} destructive onSelect={() => {}}>
          Void INV-001
        </RowMenuItem>
      </RowMenu>,
    );
    expect(getByLabelText("More for INV-001")).toBeInTheDocument();
  });
});

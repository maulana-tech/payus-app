// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link2, Trash2 } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { RowMenu, RowMenuItem } from "../src/components/dashboard/screens/kit";

// Every destructive and every quiet action in the dashboard lives behind a
// row menu: copy the pay link, open the pay page, ask the Collector to
// chase, refund, stop a recurring invoice, void it, publish a shop.
//
// They were all dead. The item took `onSelect`, which is Radix's name;
// Base UI's `Menu.Item` declares `onClick`. React accepts `onSelect` on any
// element because it is a real DOM event — for selecting *text* — so it
// type-checked, rendered, and ran on an event a click never fires.
//
// Nothing failed. Twelve controls simply did nothing, and only a person
// clicking one would ever know. That is what this file is for.

describe("row menu", () => {
  it("runs the action when an item is clicked", async () => {
    const user = userEvent.setup();
    const copy = vi.fn();

    render(
      <RowMenu label="More for INV-001">
        <RowMenuItem icon={Link2} onClick={copy}>
          Copy the pay link
        </RowMenuItem>
      </RowMenu>,
    );

    await user.click(screen.getByRole("button", { name: "More for INV-001" }));
    await user.click(await screen.findByText("Copy the pay link"));
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it("leaves a disabled item alone", async () => {
    const user = userEvent.setup();
    const danger = vi.fn();

    render(
      <RowMenu label="More for INV-002">
        <RowMenuItem icon={Trash2} destructive disabled onClick={danger}>
          Void INV-002
        </RowMenuItem>
      </RowMenu>,
    );

    await user.click(screen.getByRole("button", { name: "More for INV-002" }));
    await user.click(await screen.findByText("Void INV-002"));
    expect(danger).not.toHaveBeenCalled();
  });

  it("gives each action its own handler", async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const second = vi.fn();

    render(
      <RowMenu label="More for INV-003">
        <RowMenuItem icon={Link2} onClick={first}>
          Copy the pay link
        </RowMenuItem>
        <RowMenuItem icon={Trash2} destructive onClick={second}>
          Void INV-003
        </RowMenuItem>
      </RowMenu>,
    );

    await user.click(screen.getByRole("button", { name: "More for INV-003" }));
    await user.click(await screen.findByText("Void INV-003"));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

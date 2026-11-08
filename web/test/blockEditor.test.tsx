// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { BlockEditor } from "../src/components/canvas/BlockEditor";
import {
  type Block,
  toBlocks,
  toHtml,
} from "../src/features/storefront/blocks";

// Editing the page without typing a tag.
//
// Every case here asserts the HTML that comes out, because that is the one
// thing stored — a block editor that looks right and writes the wrong page
// is worse than no block editor.

/**
 * The editor is controlled, so the test holds the list the way the canvas
 * does — and asserts the page that list would write, because that is the
 * one thing stored.
 */
function open(html = "") {
  const start = toBlocks(html);
  let latest = start;

  function Host() {
    const [blocks, setBlocks] = useState<Block[]>(start);
    const [showing, setShowing] = useState<string | null>(start[0]?.id ?? null);
    latest = blocks;
    return (
      <BlockEditor
        blocks={blocks}
        onBlocks={setBlocks}
        open={showing}
        onOpen={setShowing}
      />
    );
  }

  render(<Host />);
  const page = () => toHtml(latest);
  return { page };
}

describe("the block editor", () => {
  it("says so when the page is empty, and adds the first block", async () => {
    const { page } = open();
    expect(screen.getByText(/Nothing on the page yet/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Add a block/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Heading/ }));

    expect(page()).toBe("<h2>A heading</h2>");
  });

  it("writes what is typed into the page, escaped", async () => {
    const { page } = open("<p>Old words</p>");
    const box = screen.getByLabelText("Text");
    await userEvent.clear(box);
    await userEvent.type(box, "New & <bold> words");

    expect(page()).toBe("<p>New &amp; &lt;bold&gt; words</p>");
  });

  it("moves a block, and the page moves with it", async () => {
    const { page } = open("<h2>First</h2><p>Second</p>");
    await userEvent.click(screen.getByRole("button", { name: "Move Text up" }));
    expect(page()).toBe("<p>Second</p>\n<h2>First</h2>");
  });

  it("will not move the ends off the page", () => {
    open("<h2>First</h2><p>Second</p>");
    expect(
      screen.getByRole("button", { name: "Move Heading up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Text down" }),
    ).toBeDisabled();
  });

  it("duplicates and deletes", async () => {
    const { page } = open("<h2>One</h2>");
    await userEvent.click(
      screen.getByRole("button", { name: "Duplicate Heading" }),
    );
    expect(page()).toBe("<h2>One</h2>\n<h2>One</h2>");

    await userEvent.click(
      screen.getAllByRole("button", {
        name: "Delete Heading",
      })[0] as HTMLElement,
    );
    expect(page()).toBe("<h2>One</h2>");
  });

  it("keeps markup it did not write, and lets it be edited as markup", async () => {
    const hand = '<section class="ft-col"><h2>By hand</h2></section>';
    const { page } = open(hand);

    // Shown as what it is, not flattened into fields that would lose it.
    expect(screen.getByText("Your own markup")).toBeTruthy();
    const box = screen.getByLabelText("Markup");
    expect((box as HTMLTextAreaElement).value).toBe(hand);

    await userEvent.type(box, "!");
    expect(page()).toBe(`${hand}!`);
  });

  it("reads a list out of the page and writes it back", async () => {
    const { page } = open("<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>");
    const box = screen.getByLabelText("One per line");
    expect((box as HTMLTextAreaElement).value).toBe("One\nTwo");

    // A newline in a textarea does not survive `userEvent.type` under
    // happy-dom, and the point here is the value the field reports, not
    // which keys produced it.
    fireEvent.change(box, { target: { value: "Gayo\nKintamani" } });
    expect(page()).toBe("<ul>\n  <li>Gayo</li>\n  <li>Kintamani</li>\n</ul>");
  });
});

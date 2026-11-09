// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  AGENT_KINDS,
  type AgentBlock,
  AgentPageError,
  agentBlocks,
  agentPage,
  agentPageSchema,
  describePage,
  mergeEdit,
} from "../src/features/storefront/agentPage";
import {
  type Block,
  toBlocks,
  toHtml,
} from "../src/features/storefront/blocks";
import { shopFindings } from "../src/features/storefront/findings";

// What an agent may write on someone's shop page, and what is wrong with
// one. Both are decided here, by code, with no model anywhere near them —
// which is the whole reason this file can run on every commit.

const LINKS = new Map([
  ["link-coffee", "https://payus.test/pay/lana/coffee"],
  ["this-shop", "https://payus.test/shop/kopi-senja"],
]);

const page = (...blocks: AgentBlock[]) => ({ blocks });

describe("what an agent may write", () => {
  it("takes the address from the lookup, never from what the model said", () => {
    const [block] = agentBlocks(
      page({ kind: "cta", payLink: "link-coffee", label: "Buy a bag" }),
      LINKS,
    );
    expect(block).toMatchObject({
      kind: "cta",
      href: "https://payus.test/pay/lana/coffee",
      text: "Buy a bag",
    });
  });

  it("refuses a button to an address it was not shown", () => {
    // The Payer's rule on a page: an address the model invented must not
    // reach the owner, let alone a payer. A name we never offered is not a
    // typo to be corrected — it is an answer to throw away.
    expect(() =>
      agentBlocks(page({ kind: "cta", payLink: "link-invented" }), LINKS),
    ).toThrow(AgentPageError);
    expect(() =>
      agentBlocks(
        page({ kind: "cta", payLink: "https://somewhere.else/pay" }),
        LINKS,
      ),
    ).toThrow(/not one of your addresses/);
  });

  it("leaves the cta kind out of the schema when there is nowhere to send it", () => {
    const none = agentPageSchema([]);
    const items = (
      (none.properties as Record<string, { items: Record<string, unknown> }>)
        .blocks.items as { properties: Record<string, { enum?: string[] }> }
    ).properties;
    expect(items.kind?.enum).not.toContain("cta");
    expect(items.payLink).toBeUndefined();

    // And with one, it is an enum of exactly the names we offered.
    const some = agentPageSchema(["link-coffee"]);
    const theirs = (
      (some.properties as Record<string, { items: Record<string, unknown> }>)
        .blocks.items as { properties: Record<string, { enum?: string[] }> }
    ).properties;
    expect(theirs.payLink?.enum).toEqual(["link-coffee"]);
  });

  it("stands an address in when the model names none, rather than losing the page", () => {
    // The schema cannot say "payLink is required when kind is cta", and the
    // model leaves it out when the page it is editing already has a button
    // with no address. The first address this account owns stands in — one
    // we showed it either way — and the answer lists it before anything is
    // applied.
    const [block] = agentBlocks(page({ kind: "cta", label: "Buy" }), LINKS);
    expect(block).toMatchObject({
      kind: "cta",
      href: "https://payus.test/pay/lana/coffee",
      text: "Buy",
    });
    // With nowhere at all to send it, that is a refusal, not a guess.
    expect(() =>
      agentBlocks(page({ kind: "cta", label: "Buy" }), new Map()),
    ).toThrow(/no addresses to send it to/);
  });

  it("refuses a block missing the thing it is made of, rather than dropping it", () => {
    // Dropping it would lose a paragraph with nothing on screen to say so.
    expect(() => agentBlocks(page({ kind: "card" }), LINKS)).toThrow(
      /without its pairs/,
    );
    expect(() => agentBlocks(page({ kind: "text" }), LINKS)).toThrow(
      /without its text/,
    );
    expect(() =>
      agentBlocks(
        page({ kind: "columns", pairs: [{ a: "One", b: "Only" }] }),
        LINKS,
      ),
    ).toThrow(/exactly two sides/);
  });

  it("writes every kind it offers as a block that survives the page", () => {
    // Built from AGENT_KINDS, so a kind added to the vocabulary without a
    // conversion cannot pass this file.
    const made: AgentBlock[] = AGENT_KINDS.map((kind) => {
      switch (kind) {
        case "list":
          return { kind, lines: ["One", "Two"] };
        case "card":
          return { kind, pairs: [{ a: "Hours", b: "Tuesday to Sunday." }] };
        case "columns":
          return {
            kind,
            pairs: [
              { a: "This", b: "And what it is." },
              { a: "That", b: "And what it is." },
            ],
          };
        case "steps":
        case "faq":
        case "stats":
          return { kind, pairs: [{ a: "A", b: "B" }] };
        case "divider":
        case "spacer":
          return { kind };
        case "cta":
          return { kind, payLink: "link-coffee", label: "Pay" };
        default:
          return { kind, text: "Something." };
      }
    });
    expect(made).toHaveLength(AGENT_KINDS.length);

    const blocks = agentBlocks({ blocks: made }, LINKS);
    // Out to the field it is stored in, and back: an agent's page has to be
    // one the owner can then edit row by row like any other.
    const back = toBlocks(toHtml(blocks));
    expect(back.map((block) => block.kind)).toEqual(
      blocks.map((block) => block.kind),
    );
    expect(back.some((block) => block.kind === "html")).toBe(false);
  });

  it("will not accept a page with nothing on it", () => {
    // For an edit: an empty answer would wipe the page, and that is never
    // what anyone asked for.
    expect(agentPage.safeParse({ blocks: [] }).success).toBe(false);
    expect(
      agentPage.safeParse({ blocks: [{ kind: "text", text: "Hi" }] }).success,
    ).toBe(true);
  });
});

describe("an edit over someone's own markup", () => {
  const hand = (html: string): Block => ({ id: html, kind: "html", html });

  it("puts hand-written markup back where it was", () => {
    const before: Block[] = [
      hand("<style>.a{color:red}</style>"),
      hand('<div class="stage">A whole design</div>'),
      { id: "p", kind: "text", text: "Old prose." },
    ];
    const written: Block[] = [
      { id: "n", kind: "text", text: "New prose." },
      { id: "q", kind: "faq", items: [{ q: "When?", a: "Friday." }] },
    ];

    const after = mergeEdit(before, written);
    // Nothing of the owner's is gone, and it is still at the front.
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after.map((block) => block.kind)).toEqual([
      "html",
      "html",
      "text",
      "faq",
    ]);
  });

  it("leaves a page of nothing but blocks exactly as written", () => {
    const written: Block[] = [{ id: "n", kind: "text", text: "New." }];
    expect(mergeEdit([{ id: "o", kind: "text", text: "Old." }], written)).toBe(
      written,
    );
  });

  it("does not show the owner's markup to the model at all", () => {
    // Measured, not guessed: told a 46 000-character design was there and
    // to leave it alone, the model spent all 32 000 of its output tokens
    // re-expressing that design as blocks and was cut off mid-answer. It is
    // `mergeEdit` that keeps those blocks, so there is nothing a prompt has
    // to say about them — and the surest way not to be rewritten is not to
    // be mentioned.
    const big = `<div class="stage">${"x".repeat(40_000)}</div>`;
    const said = describePage([
      hand(big),
      { id: "t", kind: "text", text: "Prose." },
    ]);
    expect(said).not.toContain("xxxx");
    expect(said).not.toContain("40");
    expect(said).toContain("1. text: Prose.");
    // It is told that something of theirs is there, and that it is kept.
    expect(said).toMatch(/a block of the owner's own markup/);
    expect(said).toMatch(/kept exactly as it is/);
  });

  it("never leaves a separator dangling, because that is a pattern to continue", () => {
    // Measured. A button whose address the sanitiser had stripped was
    // described as `cta: Browse the library → ` — arrow, then nothing. Asked
    // to edit that page the model wrote four good blocks and then repeated
    // "Browse the library →" until it had spent every one of its 12 000
    // output tokens and was cut off mid-JSON. With the arrow gone the same
    // call answered in 287. A prompt is an input like any other.
    const said = describePage([
      { id: "a", kind: "cta", href: "", text: "Browse the library" },
      { id: "b", kind: "link", href: "", text: "Elsewhere" },
      { id: "c", kind: "image", src: "", alt: "", caption: "" },
    ]);
    expect(said).not.toMatch(/→\s*$/m);
    expect(said).not.toMatch(/→\s*\n/);
    expect(said).toContain("Browse the library (no address yet)");
  });

  it("renumbers over the blocks it can actually edit", () => {
    // "Change the second one" has to mean the second thing the model was
    // shown, not the second row of a list it cannot see.
    const said = describePage([
      hand("<style>.a{color:red}</style>"),
      { id: "a", kind: "text", text: "First." },
      hand('<div class="stage">x</div>'),
      { id: "b", kind: "text", text: "Second." },
    ]);
    expect(said).toContain("1. text: First.");
    expect(said).toContain("2. text: Second.");
    expect(said).toMatch(/2 blocks of the owner's own markup/);
  });
});

describe("what is wrong with a shop", () => {
  const shop = (over: Record<string, unknown> = {}) =>
    ({
      template: "shelf",
      blurb: "",
      products: [
        {
          id: "p1",
          name: "Beans",
          description: "",
          priceMinor: "1800",
          minMinor: null,
          maxMinor: null,
          quantity: true,
          limit: 10,
          soldOut: false,
        },
      ],
      ...over,
    }) as Parameters<typeof shopFindings>[0];

  const ids = (findings: { id: string }[]) => findings.map((f) => f.id);

  it("says when nothing on the page can be bought", () => {
    const found = shopFindings(shop({ products: [] }), []);
    expect(ids(found)).toContain("no-way-to-pay");
    expect(found[0]?.severity).toBe("stop");
    expect(found[0]?.fixable).toBe(true);
  });

  it("does not flag a tip jar for having no prices", () => {
    // The whole point of a tip jar is that the payer names the amount.
    const found = shopFindings(shop({ template: "tip", products: [] }), []);
    expect(ids(found)).not.toContain("no-way-to-pay");
    expect(ids(found)).not.toContain("unpriced-item");
  });

  it("finds a button the page will strip, not just an obvious placeholder", () => {
    // The case that actually happened: a pay link inserted while the app's
    // own origin was http. It looked right in the editor, the sanitiser
    // took the address off on the way out, and the button was dead with
    // nothing on screen to say so.
    const found = shopFindings(shop(), [
      {
        id: "a",
        kind: "cta",
        href: "http://localhost:3000/pay/lana/coffee",
        text: "Buy",
      },
    ]);
    expect(ids(found)).toContain("dead-button");
    expect(found.find((f) => f.id === "dead-button")?.remedy).toMatch(/https/);
  });

  it("finds a button that goes nowhere", () => {
    const found = shopFindings(shop(), [
      { id: "a", kind: "cta", href: "https://example.com/pay", text: "Buy" },
    ]);
    expect(ids(found)).toContain("dead-button");
    // And leaves a real one alone.
    expect(
      ids(
        shopFindings(shop(), [
          {
            id: "a",
            kind: "cta",
            href: "https://payus.test/pay/lana/coffee",
            text: "Buy",
          },
        ]),
      ),
    ).not.toContain("dead-button");
  });

  it("finds a heading that introduces nothing", () => {
    const found = shopFindings(shop(), [
      { id: "h", kind: "heading", level: 2, text: "About us" },
    ]);
    expect(ids(found)).toContain("empty-heading");
  });

  it("separates what the Builder can fix from what the owner must", () => {
    // The difference is stated rather than fudged: the Builder writes the
    // page, so it can add a button; it cannot change what something costs.
    const found = shopFindings(
      shop({
        products: [
          {
            id: "p1",
            name: "Beans",
            description: "",
            priceMinor: null,
            minMinor: null,
            maxMinor: null,
            quantity: false,
            limit: 1,
            soldOut: false,
          },
        ],
      }),
      [],
      { removed: ["script"], oddlyPriced: ["Beans"] },
    );
    const by = (id: string) => found.find((f) => f.id === id);
    expect(by("unpriced-item")?.fixable).toBe(false);
    expect(by("sanitiser-removed")?.fixable).toBe(false);
    expect(by("odd-prices")?.fixable).toBe(false);
  });

  it("says nothing about a shop that is fine", () => {
    const found = shopFindings(shop({ blurb: "Beans roasted on Fridays" }), [
      { id: "t", kind: "text", text: "We roast on Fridays." },
    ]);
    expect(found).toEqual([]);
  });
});

import type { Block } from "./blocks";
import type { StorefrontView } from "./config";

// What is wrong with a shop page — decided here, by arithmetic, and never
// by a model.
//
// This is the same rule the Collector is built on: `stopReason()` is pure
// and is the whole of "knows when to stop", and the model is only reached
// once it returns null. A model asked "what is wrong with this page?" will
// always find something, because that is what it was asked; it would file
// taste as a defect and the owner would have no way to tell the two apart.
// So the findings are a fixed list of checks, each one either true or not,
// and the model is only ever handed one of them to answer.
//
// Some are the agent's to fix and some are not, and the difference is
// stated rather than fudged: the Builder writes the page, so it can add a
// button or an about section, and it cannot change what something costs.

export type Finding = {
  /** Stable, so "fix this one" names a check rather than a sentence. */
  id: string;
  /** `stop`: the page cannot do its job. `look`: worth your eyes. */
  severity: "stop" | "look";
  /** What is wrong, in one sentence the owner reads. */
  what: string;
  /** What would put it right, in one sentence. */
  remedy: string;
  /** Whether the Builder can do it, or whether it is the owner's to do. */
  fixable: boolean;
};

/**
 * Absent, however it was written.
 *
 * These rows are JSON in a column, and a field that was never set reads
 * back as `undefined` rather than `null` — so `=== null` quietly answered
 * "it has a price" for an item that has none. Worth one helper.
 */
const unset = (value: unknown): boolean =>
  value === null || value === undefined;

/**
 * An address the page can actually send someone to.
 *
 * The same rule the renderer applies: a shop page follows `https` and
 * `mailto` and nothing else, so anything else is a button that will be
 * stripped on the way out. This replaced a list of placeholder hostnames,
 * which caught `example.com` and missed the real case — an `http://` or a
 * relative address, which looks fine in the editor and is gone on the page.
 */
const usable = (href: string) => /^(https:|mailto:)/i.test(href.trim());

/**
 * An address that is a stand-in rather than a destination. Two different
 * ways to be dead, and both are worth saying: one is stripped on the way
 * out, the other arrives and goes nowhere.
 */
const placeholder = (href: string) =>
  /^\s*$|^#|example\.(com|org|net)/i.test(href.trim());

const prose = new Set([
  "text",
  "lead",
  "quiet",
  "quote",
  "note",
  "card",
  "columns",
  "list",
  "faq",
  "steps",
]);

const buttons = (blocks: Block[]): { href: string; text: string }[] =>
  blocks.flatMap((block) =>
    block.kind === "cta" || block.kind === "link"
      ? [{ href: block.href, text: block.text }]
      : block.kind === "buttons"
        ? block.items
        : [],
  );

/**
 * Everything checkable about this shop, in the order it matters.
 *
 * `removed` is what the sanitiser took out of the owner's own markup; it is
 * passed in rather than recomputed, because the sanitiser is the server's
 * and this module is pure.
 */
export function shopFindings(
  shop: Pick<StorefrontView, "template" | "blurb" | "products">,
  blocks: Block[],
  extra: { removed?: string[]; oddlyPriced?: string[] } = {},
): Finding[] {
  const out: Finding[] = [];
  const priced = shop.products.filter((p) => !unset(p.priceMinor));
  const payable = shop.template === "tip" || priced.length > 0;
  const links = buttons(blocks);

  // 1. The page cannot take money at all.
  if (!payable && links.length === 0)
    out.push({
      id: "no-way-to-pay",
      severity: "stop",
      what: "Nothing on this page can be bought: no item has a price, and there is no button to anywhere.",
      remedy:
        "Price an item, or put a button on the page pointing at one of your pay links.",
      fixable: true,
    });

  // 2. A button that goes nowhere. Objective: a placeholder, not taste.
  const dead = links.filter(
    (link) => !usable(link.href) || placeholder(link.href),
  );
  if (dead.length > 0)
    out.push({
      id: "dead-button",
      severity: "stop",
      what: `${dead.length === 1 ? "A button goes" : `${dead.length} buttons go`} nowhere: ${dead
        .map((link) => `"${link.text}"`)
        .join(", ")}.`,
      remedy:
        "A shop page follows https and mailto only, so anything else is stripped before anyone sees it. Point it at one of your own pay links.",
      fixable: true,
    });

  // 3. An item nobody can buy, on a layout that sells by the price.
  const unpriced = shop.products.filter(
    (p) => unset(p.priceMinor) && unset(p.minMinor) && unset(p.maxMinor),
  );
  if (shop.template !== "tip" && unpriced.length > 0)
    out.push({
      id: "unpriced-item",
      severity: "stop",
      what: `${unpriced.map((p) => `"${p.name || "an item"}"`).join(", ")} ${
        unpriced.length === 1 ? "has" : "have"
      } no price, so nobody can buy ${unpriced.length === 1 ? "it" : "them"}.`,
      remedy:
        "Give it a price under Items, or move the shop to a tip jar where the payer chooses.",
      fixable: false,
    });

  // 4. Nothing on the page says what this is.
  const says = blocks.some((block) => prose.has(block.kind));
  if (!says && !shop.blurb.trim())
    out.push({
      id: "says-nothing",
      severity: "look",
      what: "The page says nothing about the shop — only its name and what is for sale.",
      remedy: "A few lines about who you are and what someone is buying.",
      fixable: true,
    });

  // 5. A heading introducing nothing.
  const orphans = blocks.filter(
    (block, at) =>
      block.kind === "heading" &&
      (at === blocks.length - 1 || blocks[at + 1]?.kind === "heading"),
  );
  if (orphans.length > 0)
    out.push({
      id: "empty-heading",
      severity: "look",
      what: `${orphans
        .map((b) => `"${b.kind === "heading" ? b.text : ""}"`)
        .join(
          ", ",
        )} ${orphans.length === 1 ? "is a heading" : "are headings"} with nothing underneath.`,
      remedy: "Write the section, or take the heading out.",
      fixable: true,
    });

  // 6. Everything is sold out, which reads as a shop that has closed.
  if (shop.products.length > 0 && shop.products.every((p) => p.soldOut))
    out.push({
      id: "all-sold-out",
      severity: "look",
      what: "Every item is marked sold out, so a visitor can look but not buy.",
      remedy: "Clear sold out on what is back in stock.",
      fixable: false,
    });

  // 7. Priced well above what this merchant has charged before.
  if (extra.oddlyPriced?.length)
    out.push({
      id: "odd-prices",
      severity: "look",
      what: `${extra.oddlyPriced.map((name) => `"${name}"`).join(", ")} ${
        extra.oddlyPriced.length === 1 ? "is" : "are"
      } priced well above anything you have charged before.`,
      remedy: "Worth a second look before you publish. It may be right.",
      fixable: false,
    });

  // 8. The sanitiser took something out of their own markup.
  if (extra.removed?.length)
    out.push({
      id: "sanitiser-removed",
      severity: "look",
      what: `The sanitiser took this out of your markup: ${extra.removed
        .map((tag) => (/^[a-z][a-z0-9-]*$/.test(tag) ? `<${tag}>` : tag))
        .join(", ")}.`,
      remedy:
        "Nothing in the shop's frame may run or ask for input. The design is kept; the behaviour is not.",
      fixable: false,
    });

  return out;
}

/** One finding by id, so a fix names a check rather than quoting prose. */
export const findingById = (findings: Finding[], id: string): Finding | null =>
  findings.find((finding) => finding.id === id) ?? null;

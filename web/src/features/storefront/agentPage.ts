import { z } from "zod";
import { newId } from "@/lib/ids";
import { type Block, toHtml } from "./blocks";

// What an agent is allowed to write on a shop page.
//
// **It writes blocks, not markup.** Every answer becomes one of the kinds
// the block menu already offers, which means three things at once: the
// owner can edit what an agent wrote row by row in the same list rather
// than reading a wall of HTML; `toHtml` stays the only writer, so there is
// no second shape to keep in step; and an agent cannot reach markup the
// sanitiser would then quietly take apart.
//
// It is a *narrower* vocabulary than a person's, on purpose:
//   - no image or gallery, because a model has no photograph of this shop
//     and would write an address that does not exist;
//   - no raw html, which is the whole point;
//   - no link or button whose address it invented — see `payLink` below.
//
// The one thing it may point at is an address this account already has.
// The model picks a slug from an `enum` we built, and we look that slug up
// in a `Map` to get the address: nothing it said is interpolated anywhere.
// This is the Payer's rule — the destination must be one we showed it —
// applied to a page instead of to a payout.

/** The kinds an agent may write, mapped onto the block vocabulary. */
export const AGENT_KINDS = [
  "heading",
  "text",
  "lead",
  "quiet",
  "quote",
  "note",
  "list",
  "card",
  "columns",
  "steps",
  "faq",
  "stats",
  "divider",
  "spacer",
  "cta",
] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

/**
 * The bounds live here rather than in the JSON Schema, because Bedrock's
 * validator rejects array `minItems`/`maxItems` and numeric bounds with a
 * 400. The schema says the range in each description so the model still
 * knows it; this is what decides whether the answer is acted on.
 */
export const MAX_BLOCKS = 40;
const MAX_TEXT = 600;
const MAX_LINE = 160;
const MAX_LINES = 12;
const MAX_PAIRS = 8;
const MAX_LABEL = 80;

const pair = z
  .object({
    a: z.string().trim().min(1).max(120),
    b: z.string().trim().max(400),
  })
  .strict();

const agentBlock = z
  .object({
    kind: z.enum(AGENT_KINDS),
    text: z.string().trim().max(MAX_TEXT).optional(),
    big: z.boolean().optional(),
    lines: z
      .array(z.string().trim().min(1).max(MAX_LINE))
      .max(MAX_LINES)
      .optional(),
    pairs: z.array(pair).max(MAX_PAIRS).optional(),
    payLink: z.string().trim().max(60).optional(),
    label: z.string().trim().max(MAX_LABEL).optional(),
  })
  .strict();

export type AgentBlock = z.infer<typeof agentBlock>;

/**
 * An edit or a fix: the page as it would be. At least one block, because an
 * empty answer would wipe the page and that is never what was asked for.
 */
export const agentPage = z
  .object({ blocks: z.array(agentBlock).min(1).max(MAX_BLOCKS) })
  .strict();

/**
 * A new shop: the page is optional. A shop that is a list of things for
 * sale and nothing else is a real shop, and inventing an "about us" for a
 * description that gave none is worse than leaving it blank.
 */
export const agentPageOrNone = z
  .object({ blocks: z.array(agentBlock).max(MAX_BLOCKS).optional() })
  .strict();

/**
 * The JSON Schema the API constrains the answer with.
 *
 * `payLinks` is the list of slugs this account actually has. When it is
 * empty the `cta` kind is left out of the enum altogether, so there is no
 * shape in which a model can ask for a button and then have to invent an
 * address for it.
 */
export function agentPageSchema(payLinks: string[]): Record<string, unknown> {
  const kinds =
    payLinks.length > 0 ? AGENT_KINDS : AGENT_KINDS.filter((k) => k !== "cta");
  const properties: Record<string, unknown> = {
    kind: {
      type: "string",
      enum: kinds,
      description:
        "heading and text are the ordinary ones. lead is a larger opening line, quiet a smaller note, note one line set apart. list takes `lines`. card takes one pair (title, body); columns takes exactly two; steps, faq and stats take one pair each (step/what happens, question/answer, figure/what it counts). divider and spacer take nothing.",
    },
    text: {
      type: "string",
      maxLength: MAX_TEXT,
      description:
        "For heading, text, lead, quiet, quote and note. Nothing else uses it.",
    },
    big: {
      type: "boolean",
      description:
        "heading only: true for a section heading, false for a smaller one.",
    },
    lines: {
      type: "array",
      items: { type: "string", maxLength: MAX_LINE },
      description: `list only. Between 1 and ${MAX_LINES} lines.`,
    },
    pairs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["a", "b"],
        properties: {
          a: { type: "string", maxLength: 120 },
          b: { type: "string", maxLength: 400 },
        },
      },
      description: `For card, columns, steps, faq and stats. card needs exactly 1, columns exactly 2, the rest between 1 and ${MAX_PAIRS}.`,
    },
  };

  if (payLinks.length > 0) {
    properties.payLink = {
      type: "string",
      enum: payLinks,
      description:
        "cta only: which of this account's own addresses the button goes to. You may not write an address of your own.",
    };
    properties.label = {
      type: "string",
      maxLength: MAX_LABEL,
      description: 'cta only: the words on the button, like "Buy the report".',
    };
  }

  return {
    type: "object",
    additionalProperties: false,
    required: ["blocks"],
    properties: {
      blocks: {
        type: "array",
        description: `The page, in order. Between 1 and ${MAX_BLOCKS} blocks.`,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties,
        },
      },
    },
  };
}

export class AgentPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentPageError";
  }
}

const need = <T>(
  value: T | undefined | null,
  kind: string,
  field: string,
): T => {
  if (value === undefined || value === null)
    throw new AgentPageError(`A ${kind} block arrived without its ${field}.`);
  return value;
};

/**
 * One agent block as a real block.
 *
 * A block missing the field its kind is made of throws rather than being
 * dropped: losing a paragraph quietly is worse than saying the answer was
 * not usable, and the caller turns this into a sentence the owner reads.
 */
function one(block: AgentBlock, links: Map<string, string>): Block {
  const id = newId(10);
  const text = () => need(block.text, block.kind, "text").trim();
  const pairs = () => {
    const got = need(block.pairs, block.kind, "pairs");
    if (got.length === 0)
      throw new AgentPageError(`A ${block.kind} block arrived empty.`);
    return got;
  };

  switch (block.kind) {
    case "heading":
      return {
        id,
        kind: "heading",
        level: block.big === false ? 3 : 2,
        text: text(),
      };
    case "text":
    case "lead":
    case "quiet":
    case "quote":
    case "note":
      return { id, kind: block.kind, text: text() };
    case "list": {
      const lines = need(block.lines, "list", "lines");
      if (lines.length === 0)
        throw new AgentPageError("A list block arrived empty.");
      return { id, kind: "list", ordered: false, items: lines };
    }
    case "card": {
      const [first] = pairs();
      return { id, kind: "card", title: first?.a ?? "", text: first?.b ?? "" };
    }
    case "columns": {
      const got = pairs();
      if (got.length !== 2)
        throw new AgentPageError("A columns block needs exactly two sides.");
      return {
        id,
        kind: "columns",
        left: { title: got[0]?.a ?? "", text: got[0]?.b ?? "" },
        right: { title: got[1]?.a ?? "", text: got[1]?.b ?? "" },
      };
    }
    case "steps":
      return {
        id,
        kind: "steps",
        items: pairs().map((p) => ({ title: p.a, text: p.b })),
      };
    case "faq":
      return {
        id,
        kind: "faq",
        items: pairs().map((p) => ({ q: p.a, a: p.b })),
      };
    case "stats":
      return {
        id,
        kind: "stats",
        items: pairs().map((p) => ({ figure: p.a, label: p.b })),
      };
    case "divider":
      return { id, kind: "divider" };
    case "spacer":
      return { id, kind: "spacer", size: "md" };
    case "cta": {
      // A flat object schema cannot say "payLink is required when kind is
      // cta", and the model will leave it out — faithfully, when the page
      // it is editing already carries a button whose address the sanitiser
      // stripped. Refusing the whole page over that is the wrong trade, so
      // the first address this account owns stands in. That is still an
      // address we showed it; it is only *we* who chose rather than the
      // model, and the answer lists every address before the owner applies
      // anything.
      const slug = block.payLink ?? [...links.keys()][0];
      if (!slug)
        throw new AgentPageError(
          "A button was asked for and this account has no addresses to send it to.",
        );
      // The lookup, not the string: whatever the model said, the address
      // comes out of this map or the block is refused.
      const href = links.get(slug);
      if (!href)
        throw new AgentPageError(
          `The agent asked for a button to "${slug}", which is not one of your addresses.`,
        );
      return { id, kind: "cta", href, text: block.label?.trim() || "Pay here" };
    }
  }
}

/** The whole answer, as blocks. Throws `AgentPageError` on anything unusable. */
export function agentBlocks(
  answer: { blocks: AgentBlock[] },
  links: Map<string, string>,
): Block[] {
  return answer.blocks.map((block) => one(block, links));
}

/** The answer as the HTML field stores it. */
export const agentHtml = (
  answer: { blocks: AgentBlock[] },
  links: Map<string, string>,
): string => toHtml(agentBlocks(answer, links));

/**
 * The page as it stands, for a model that is about to change it.
 *
 * Numbered, because an instruction like "drop the third question" has to
 * land somewhere, and written as the same vocabulary the answer uses, so
 * the model reads and writes one thing rather than two.
 */
export function describePage(blocks: Block[]): string {
  const mine = blocks.filter((block) => block.kind !== "html");
  const theirs = blocks.length - mine.length;
  const kept =
    theirs === 0
      ? ""
      : `\n\nThe page also carries ${theirs === 1 ? "a block" : `${theirs} blocks`} of the owner's own markup. ${theirs === 1 ? "It is" : "They are"} not shown to you and ${theirs === 1 ? "is" : "are"} not yours to write: ${theirs === 1 ? "it is" : "they are"} kept exactly as ${theirs === 1 ? "it is" : "they are"} and put back around whatever you return.`;

  if (mine.length === 0)
    return `There is nothing on the page you can edit.${kept}`;
  return (
    mine.map((block, at) => `${at + 1}. ${describeBlock(block)}`).join("\n") +
    kept
  );
}

function describeBlock(block: Block): string {
  switch (block.kind) {
    case "heading":
      return `heading (${block.level === 2 ? "section" : "smaller"}): ${block.text}`;
    case "text":
    case "lead":
    case "quiet":
    case "quote":
    case "note":
      return `${block.kind}: ${block.text}`;
    case "list":
      return `list: ${block.items.join("; ")}`;
    case "card":
      return `card: ${block.title} — ${block.text}`;
    case "columns":
      return `columns: ${block.left.title} — ${block.left.text} | ${block.right.title} — ${block.right.text}`;
    case "steps":
      return `steps: ${block.items.map((i) => `${i.title} — ${i.text}`).join("; ")}`;
    case "faq":
      return `faq: ${block.items.map((i) => `${i.q} — ${i.a}`).join("; ")}`;
    case "stats":
      return `stats: ${block.items.map((i) => `${i.figure} — ${i.label}`).join("; ")}`;
    case "gallery":
      return `gallery of ${block.items.length} images`;
    case "image":
      return `image: ${block.alt || block.caption || block.src}`;
    case "table":
      return `table with columns ${block.head.join(", ")} and ${block.rows.length} rows`;
    case "buttons":
      return `buttons: ${block.items.map((i) => i.text).join("; ")}`;
    case "link":
    case "cta":
      // The arrow only when there is something after it. A button whose
      // address the sanitiser stripped left the line ending `→ ` — and a
      // dangling separator is a pattern to continue: asked to edit that
      // page, the model wrote four good blocks and then repeated
      // "Browse the library →\n\n\n…" until it had spent all 12 000 of its
      // output tokens. Measured, not supposed.
      return block.href
        ? `${block.kind}: ${block.text} → ${block.href}`
        : `${block.kind}: ${block.text} (no address yet)`;
    case "divider":
      return "divider";
    case "spacer":
      return "space";
    case "html":
      // Never reached from `describePage`, which leaves these out: telling
      // a model "there is a 46 000-character design here, leave it alone"
      // is an invitation to try. Asked to shorten a page, it spent all
      // 32 000 of its output tokens re-expressing that design as blocks and
      // was cut off mid-answer. It is `mergeEdit` that keeps them, not a
      // sentence; so the sentence is gone and they are simply not shown.
      return `a block of the owner's own markup (${block.html.length} characters)`;
  }
}

/**
 * The owner's own markup, put back after an edit.
 *
 * The agent writes blocks, and there is no block that means "someone's
 * hand-written `<div class="stage">`". So an edit that simply returned the
 * agent's answer would delete a pasted design — silently, and with no way
 * back. The rule instead is: **an edit may not remove a block of the
 * owner's own markup.** Each one is put back at the index it held, so a
 * design at the top of the page stays at the top and one at the bottom
 * stays at the bottom; anything the agent wrote fills in around them.
 *
 * This is why the page described to the model says "leave this one exactly
 * as it is" for those blocks rather than quoting them: the protection is
 * here, in code, and not a line of a prompt it could talk itself out of.
 */
export function mergeEdit(before: Block[], written: Block[]): Block[] {
  const kept = before
    .map((block, at) => ({ block, at }))
    .filter(({ block }) => block.kind === "html");
  if (kept.length === 0) return written;

  const out = [...written];
  for (const { block, at } of kept)
    out.splice(Math.min(at, out.length), 0, block);
  return out;
}

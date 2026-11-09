import "server-only";
import { getServerEnv } from "../../../env.server";
import { toDecimal } from "../../../features/invoices/money";
import {
  AgentPageError,
  agentBlocks,
  agentPage,
  agentPageOrNone,
  agentPageSchema,
  describePage,
  mergeEdit,
} from "../../../features/storefront/agentPage";
import { type Block, toHtml } from "../../../features/storefront/blocks";
import {
  type StorefrontView,
  storefrontInput,
} from "../../../features/storefront/config";
import {
  type Finding,
  findingById,
  shopFindings,
} from "../../../features/storefront/findings";
import {
  askForJson,
  ClaudeNotConfiguredError,
  ClaudeShapeError,
  type Completion,
  claudeConfigured,
} from "../../lib/claude";
import { listInvoices } from "../invoices/invoices.service";
import { listMyLinks } from "../paymentLinks/paymentLinks.service";
import { readPage } from "../storefront/readPage";
import { sanitizeShopHtml } from "../storefront/sanitize";
import {
  createStorefront,
  listStorefronts,
} from "../storefront/storefront.service";

// The Builder: turns a sentence about a shop into a storefront. It writes
// configuration, never markup, and what it writes is validated against the
// very same schema the hand editor uses — so there is no shape it can reach
// that a person could not, and none the renderer cannot show.
//
// It writes a draft. Publishing stays an act of the owner's, because putting
// a price in front of the public is a commercial decision and not a
// mechanical one.

const CONFIG_FIELDS = {
  type: "object",
  additionalProperties: false,
  required: [
    "slug",
    "title",
    "blurb",
    "template",
    "theme",
    "accent",
    "products",
  ],
  properties: {
    slug: {
      type: "string",
      pattern: "^[a-z0-9]+(-[a-z0-9]+)*$",
      maxLength: 40,
      description: "The public address, lowercase words joined by hyphens.",
    },
    title: { type: "string", maxLength: 80 },
    blurb: { type: "string", maxLength: 300 },
    template: {
      type: "string",
      enum: ["shelf", "menu", "single", "tip"],
      description:
        "shelf for a few priced items, menu for a long list, single for one offer, tip when the payer names the amount",
    },
    theme: {
      type: "string",
      enum: ["paper", "ink", "sun"],
      description:
        "paper is warm and quiet, ink is dark, sun is warm and bright",
    },
    accent: {
      type: "string",
      enum: ["clay", "olive", "indigo", "plum", "ochre", "sea"],
      description: "One colour, used for prices and buttons.",
    },
    products: {
      type: "array",
      // No minItems/maxItems: Bedrock's schema validator rejects them. The
      // real bound is the zod schema the answer is parsed with.
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "price"],
        properties: {
          name: { type: "string", maxLength: 80 },
          description: { type: "string", maxLength: 200 },
          quantity: {
            type: "boolean",
            description:
              "true when someone might buy more than one of it at a time",
          },
          price: {
            type: ["string", "null"],
            pattern: "^[0-9]{1,12}(\\.[0-9]{1,2})?$",
            description:
              "Decimal, like 12.50, as a string. Null when the payer chooses.",
          },
        },
      },
    },
  },
} as const;

/**
 * The whole answer for a new shop: the configuration, plus the page.
 *
 * Built per request rather than declared once, because the `payLink` enum
 * is this account's own addresses and nothing else.
 */
function buildSchema(payLinks: string[]): Record<string, unknown> {
  const page = agentPageSchema(payLinks);
  const fields = CONFIG_FIELDS as unknown as {
    required: string[];
    properties: Record<string, unknown>;
  };
  return {
    type: "object",
    additionalProperties: false,
    // `blocks` is deliberately not required: a shop that is a list of items
    // and nothing else is a real shop.
    required: fields.required,
    properties: {
      ...fields.properties,
      blocks: (page.properties as Record<string, unknown>).blocks,
    },
  };
}

const PAGE_RULES = `The page is written as blocks, not as markup. There is
no field for HTML, CSS or scripts and none will be accepted — what you write
fills a page that is already designed, in the owner's own colours.

The blocks you may use, and what each is made of:
- heading, text, lead, quiet, quote, note: one piece of text.
- list: lines.
- card: one pair — a title and a short body.
- columns: exactly two pairs, shown side by side on a wide screen.
- steps: a pair per step — what to do, and what happens.
- faq: a pair per question — the question, and the answer.
- stats: a pair per figure — the figure, and what it counts.
- divider, spacer: nothing at all.
- cta: a button. You choose which of the owner's own addresses it goes to by
  name, from the list given to you. You cannot write an address.

How to use them:
- Open with a lead, not a heading: the shop's name is already above you.
- One idea per block. Do not write an essay in a single text block.
- Reach for faq and steps when the description answers questions or
  describes a process. They are better than prose for both.
- Say nothing you were not told. A shop that did not mention shipping has no
  shipping section.
- No block about prices: the items are listed on the page already, with what
  they cost.`;

const SYSTEM = `You are the Builder at Payus. You turn a description of a
small business into the configuration for a page it can sell from.

Rules you must follow:
- The address must be short, lowercase, hyphenated, and must not be one of
  the addresses already taken, which are listed for you.
- Pick the layout that fits: a shelf for a few priced items, a menu for a
  long list, single for one offer, a tip jar when the payer names the amount.
  A tip jar has no prices at all: leave every price null.
- Set quantity true only for something countable that someone would buy
  several of — a bag of beans, not a wedding photography package.
- Prices are decimals in the shop's currency, as strings: "12.50".
- Write between one and six items unless the description clearly calls for
  more. Invent nothing the description does not support: if it does not say
  what something costs, leave the price null rather than guessing.
- Descriptions are one short sentence, in the owner's voice, no marketing
  padding.
- Choose a theme and an accent that suit the trade, and say nothing about
  layout or styling beyond those two words: the page is already designed.

${PAGE_RULES}`;

const EDIT_SYSTEM = `You are the Builder at Payus, changing a page that
already exists and belongs to someone else.

You are given the page as it stands, numbered, and one instruction. Return
the whole page as you would have it afterwards.

- Change what you were asked to change and leave the rest **word for word**.
  Rewriting a sentence nobody asked you to rewrite is the thing this seat
  must not do: the owner wrote it.
- Keep the order of everything you are not moving.
- A block described as the owner's own markup is not yours. Leave it out of
  your answer entirely; it is put back where it was, untouched.
- If the instruction asks for something you cannot do with the blocks you
  have, do as much of it as you can and leave the rest alone.

${PAGE_RULES}`;

const FIX_SYSTEM = `You are the Builder at Payus, putting one thing right on
a page that already exists.

You are given the page as it stands, numbered, and a single finding that
this application computed — not an opinion, a check that came out true.
Return the whole page as you would have it afterwards.

- Address that finding and nothing else. Another sentence you would have
  written differently is not yours to change.
- Keep every other block word for word, in the same order.
- A block described as the owner's own markup is not yours. Leave it out of
  your answer entirely; it is put back where it was, untouched.

${PAGE_RULES}`;

/**
 * The addresses this account already has, keyed by a name the model picks
 * from. The key is what goes in the `enum`; the address never does, so
 * nothing the model said is interpolated into an href. This is the Payer's
 * rule — the destination must be one we showed it — on a page.
 */
export async function payTargets(
  owner: string,
  thisShop?: { slug: string; title: string },
): Promise<{ key: string; href: string; what: string }[]> {
  const origin = (getServerEnv().APP_URL ?? "").replace(/\/$/, "");
  const [links, shops] = await Promise.all([
    listMyLinks(owner),
    listStorefronts(owner),
  ]);
  const out: { key: string; href: string; what: string }[] = [];

  if (thisShop?.slug)
    out.push({
      key: "this-shop",
      href: `${origin}/shop/${thisShop.slug}`,
      what: `this shop's own page, "${thisShop.title}"`,
    });
  for (const link of links) {
    if (link.state === "archived") continue;
    out.push({
      key: `link-${link.slug}`,
      href: `${origin}/pay/${owner}/${link.slug}`,
      what: `your pay link "${link.title}"`,
    });
  }
  for (const shop of shops) {
    if (shop.slug === thisShop?.slug) continue;
    out.push({
      key: `shop-${shop.slug}`,
      href: `${origin}/shop/${shop.slug}`,
      what: `your shop "${shop.title}"`,
    });
  }
  out.push({
    key: "profile",
    href: `${origin}/pay/${owner}`,
    what: `your profile page, where the payer names the amount`,
  });
  return out;
}

const targetMap = (targets: { key: string; href: string }[]) =>
  new Map(targets.map((target) => [target.key, target.href]));

const describeTargets = (targets: { key: string; what: string }[]) =>
  targets.length === 0
    ? "This account has no addresses yet, so you may not use a cta block."
    : [
        "Addresses you may send a button to, by name:",
        ...targets.map((target) => `- ${target.key}: ${target.what}`),
      ].join("\n");

export type BuilderFacts = {
  owner: string;
  takenSlugs: string[];
  /** The merchant's existing prices, for a sanity check afterwards. */
  priorPricesMinor: bigint[];
};

export async function builderFacts(owner: string): Promise<BuilderFacts> {
  const [stores, invoices] = await Promise.all([
    listStorefronts(owner),
    listInvoices(owner),
  ]);
  const prices: bigint[] = [];
  for (const store of stores)
    for (const product of store.products)
      if (product.priceMinor) prices.push(BigInt(product.priceMinor));
  for (const invoice of invoices) prices.push(BigInt(invoice.totalMinor));
  return {
    owner,
    takenSlugs: stores.map((store) => store.slug),
    priorPricesMinor: prices,
  };
}

export function builderPrompt(description: string, facts: BuilderFacts) {
  return [
    `The owner is @${facts.owner}.`,
    "",
    "They describe the shop like this:",
    description.trim(),
    "",
    facts.takenSlugs.length > 0
      ? `Addresses already taken, which you may not reuse: ${facts.takenSlugs.join(", ")}`
      : "No addresses are taken yet.",
  ].join("\n");
}

const median = (values: bigint[]): bigint | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * Prices far outside what this merchant has charged before. Not a refusal —
 * the owner publishes, so this is something to point at, not to block.
 */
export function oddPrices(
  products: { name: string; price: string | null }[],
  priorPricesMinor: bigint[],
): string[] {
  const middle = median(priorPricesMinor);
  if (!middle || middle <= 0n) return [];
  const ceiling = middle * 3n;
  return products
    .filter((product) => {
      if (!product.price) return false;
      const [whole, frac = ""] = product.price.split(".");
      const minor =
        BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0").slice(0, 2));
      return minor > ceiling;
    })
    .map((product) => product.name);
}

export type BuilderRun = {
  storefront: StorefrontView;
  /** Items priced well above anything this merchant has charged before. */
  oddly: string[];
  model: string;
};

export type Ask = typeof askForJson;

/**
 * The model's answer as blocks, or a sentence saying why it was not usable.
 *
 * Validated twice, as everything here is: the API constrained the shape,
 * and this is where *this application* decides whether to act on it.
 */
function pageFrom(
  json: unknown,
  targets: { key: string; href: string }[],
  shape: typeof agentPage | typeof agentPageOrNone = agentPage,
): Block[] {
  const parsed = shape.safeParse(json);
  if (!parsed.success)
    throw new ClaudeShapeError(
      `The Builder answered with a page this app will not store: ${
        parsed.error.issues[0]?.message ?? "unknown"
      }`,
    );
  try {
    return agentBlocks(
      { blocks: parsed.data.blocks ?? [] },
      targetMap(targets),
    );
  } catch (error) {
    if (error instanceof AgentPageError)
      throw new ClaudeShapeError(error.message);
    throw error;
  }
}

/** Writes a storefront from a description, as a draft. */
export async function runBuilder(
  owner: string,
  description: string,
  options: { ask?: Ask } = {},
): Promise<BuilderRun> {
  const ask = options.ask ?? askForJson;
  if (!options.ask && !claudeConfigured()) throw new ClaudeNotConfiguredError();
  if (description.trim().length < 8)
    throw new ClaudeShapeError("Say a little more about the shop.");

  const facts = await builderFacts(owner);
  const targets = await payTargets(owner);
  const completion: Completion = await ask({
    system: SYSTEM,
    prompt: `${builderPrompt(description, facts)}\n\n${describeTargets(targets)}`,
    schema: buildSchema(targets.map((target) => target.key)),
    effort: "medium",
  });

  // One answer carries both the configuration and the page, so the page is
  // lifted out before it is parsed: the page schema is strict, and the
  // configuration keys beside it are not its business.
  const answered = (completion.json ?? {}) as Record<string, unknown>;
  const blocks = pageFrom(
    { blocks: answered.blocks },
    targets,
    agentPageOrNone,
  );

  // The same schema the hand editor is held to, applied to a model's answer
  // — including the page, which arrives here as the HTML field because
  // `toHtml` is the only thing that writes one.
  const { blocks: _page, ...config_ } = answered;
  const parsed = storefrontInput.safeParse({
    ...config_,
    html: toHtml(blocks),
  });
  if (!parsed.success)
    throw new ClaudeShapeError(
      `The Builder answered in a shape this app will not store: ${
        parsed.error.issues[0]?.message ?? "unknown"
      }`,
    );
  const config = parsed.data;

  // Reserved addresses are refused by the schema above, which the hand
  // editor is held to as well — there is deliberately no second check here.
  if (facts.takenSlugs.includes(config.slug))
    throw new ClaudeShapeError(
      `"${config.slug}" is already one of your addresses; ask again and it will pick another.`,
    );

  const model = `${completion.model}@${completion.promptVersion}`;
  const storefront = await createStorefront(owner, config, "builder-agent");
  return {
    storefront,
    oddly: oddPrices(config.products, facts.priorPricesMinor),
    model,
  };
}

// ------------------------------------------------- changing one that exists

/** A shop of this owner's, by id. Owner-scoped, so a guessed id finds none. */
async function shopOf(owner: string, id: string): Promise<StorefrontView> {
  const shop = (await listStorefronts(owner)).find((one) => one.id === id);
  if (!shop) throw new ClaudeShapeError("That shop is not one of yours.");
  return shop;
}

export type ShopReview = {
  shopId: string;
  findings: Finding[];
};

/**
 * What is wrong with a shop, with no model involved at all.
 *
 * This is the whole of "fix": the checks decide, and the Builder is only
 * ever handed one of them. A model asked what is wrong with a page always
 * answers something, because that is what it was asked.
 */
export async function reviewShop(
  owner: string,
  id: string,
): Promise<ShopReview> {
  const shop = await shopOf(owner, id);
  const facts = await builderFacts(owner);
  const { removed } = sanitizeShopHtml(shop.html);
  const blocks = readPage(shop.htmlClean);
  return {
    shopId: shop.id,
    findings: shopFindings(shop, blocks, {
      removed,
      oddlyPriced: oddPrices(
        shop.products.map((product) => ({
          name: product.name,
          price: product.priceMinor
            ? toDecimal(BigInt(product.priceMinor))
            : null,
        })),
        facts.priorPricesMinor,
      ),
    }),
  };
}

export type PageProposal = {
  shopId: string;
  /** What the page is now, so the screen can show the difference. */
  before: Block[];
  /** What it would be. Nothing is written until the owner says so. */
  after: Block[];
  /** The HTML those blocks write, ready to save. */
  html: string;
  /** What was asked for, echoed back onto the proposal. */
  asked: string;
  model: string;
};

/** Shared by edit and fix: one instruction, the page back as blocks. */
async function proposePage(
  owner: string,
  id: string,
  instruction: string,
  system: string,
  ask: Ask,
): Promise<PageProposal> {
  const shop = await shopOf(owner, id);
  const before = readPage(shop.htmlClean);
  const targets = await payTargets(owner, {
    slug: shop.slug,
    title: shop.title,
  });

  const completion: Completion = await ask({
    system,
    prompt: [
      `The shop is "${shop.title}" at /shop/${shop.slug}.`,
      shop.blurb.trim() ? `Its one line is: ${shop.blurb.trim()}` : "",
      "",
      "The page as it stands:",
      describePage(before),
      "",
      describeTargets(targets),
      "",
      instruction,
    ]
      .filter(Boolean)
      .join("\n"),
    schema: agentPageSchema(targets.map((target) => target.key)),
    effort: "medium",
  });

  const written = pageFrom(completion.json, targets);
  // The owner's own markup is put back where it was. The agent cannot
  // express it, so an answer that simply omitted it would delete a design.
  const after = mergeEdit(before, written);
  const html = toHtml(after);

  // Held to the same schema a person's save is held to, before it is ever
  // offered to the owner as something to apply.
  const parsed = storefrontInput.safeParse({
    slug: shop.slug,
    title: shop.title,
    blurb: shop.blurb,
    template: shop.template,
    theme: shop.theme,
    accent: shop.accent,
    currency: shop.currency,
    html,
    products: shop.products.map((product) => ({
      name: product.name,
      description: product.description,
      price: product.priceMinor ? toDecimal(BigInt(product.priceMinor)) : null,
      quantity: product.quantity,
    })),
  });
  if (!parsed.success)
    throw new ClaudeShapeError(
      `The Builder's page is a shape this app will not store: ${
        parsed.error.issues[0]?.message ?? "unknown"
      }`,
    );

  return {
    shopId: shop.id,
    before,
    after,
    html,
    asked: instruction,
    model: `${completion.model}@${completion.promptVersion}`,
  };
}

/** Changes a page to an instruction. Proposes; it does not write. */
export async function runShopEdit(
  owner: string,
  id: string,
  instruction: string,
  options: { ask?: Ask } = {},
): Promise<PageProposal> {
  const ask = options.ask ?? askForJson;
  if (!options.ask && !claudeConfigured()) throw new ClaudeNotConfiguredError();
  if (instruction.trim().length < 4)
    throw new ClaudeShapeError("Say what should change.");
  return proposePage(
    owner,
    id,
    `What the owner asks for:\n${instruction.trim()}`,
    EDIT_SYSTEM,
    ask,
  );
}

/**
 * Puts one computed finding right. The finding is named by id, looked up in
 * the review, and its own sentence is what reaches the model — nothing the
 * caller typed is passed through.
 */
export async function runShopFix(
  owner: string,
  id: string,
  findingId: string,
  options: { ask?: Ask } = {},
): Promise<PageProposal> {
  const ask = options.ask ?? askForJson;
  if (!options.ask && !claudeConfigured()) throw new ClaudeNotConfiguredError();

  const review = await reviewShop(owner, id);
  const finding = findingById(review.findings, findingId);
  if (!finding)
    throw new ClaudeShapeError(
      "That is not something this page is currently flagged for.",
    );
  if (!finding.fixable)
    throw new ClaudeShapeError(
      `${finding.what} ${finding.remedy} That one is yours to do, not the Builder's.`,
    );

  return proposePage(
    owner,
    id,
    `The finding to address:\n${finding.what}\n${finding.remedy}`,
    FIX_SYSTEM,
    ask,
  );
}

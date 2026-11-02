import "server-only";
import {
  type StorefrontView,
  storefrontInput,
} from "../../../features/storefront/config";
import {
  askForJson,
  ClaudeNotConfiguredError,
  ClaudeShapeError,
  type Completion,
  claudeConfigured,
} from "../../lib/claude";
import { listInvoices } from "../invoices/invoices.service";
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

const CONFIG_SCHEMA = {
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
    html: {
      type: "string",
      description:
        "Optional. A short section about the shop, as simple HTML: h2, p, ul, li, strong, em, a. Nothing else survives.",
    },
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

const SYSTEM = `You are the Builder at Payus. You turn a description of a
small business into the configuration for a page it can sell from.

You are writing configuration, not a web page. There is no field for markup,
styling or scripts, and none will be accepted. What you write fills a
template that already exists.

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
- You may add a short "about" section as simple HTML — headings, paragraphs,
  lists, links. Scripts, styles, frames and forms are stripped before it is
  stored, so do not reach for them. Leave it out if the description gives
  you nothing to say.
- Choose a theme and an accent that suit the trade, and say nothing about
  layout or styling beyond those two words: the page is already designed.`;

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
  const completion: Completion = await ask({
    system: SYSTEM,
    prompt: builderPrompt(description, facts),
    schema: CONFIG_SCHEMA as unknown as Record<string, unknown>,
    effort: "medium",
  });

  // The same schema the hand editor is held to, applied to a model's answer.
  const parsed = storefrontInput.safeParse(completion.json);
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

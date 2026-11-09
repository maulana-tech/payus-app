import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTestDb,
  type IsolatedDb,
  postgresAvailable,
} from "./helpers/pgTestDb";

// The storefront service and the Builder's eval set. The model is stubbed,
// so what is tested is the part that decides whether an answer may be
// stored — which is the schema the hand editor is held to as well.
const available = await postgresAvailable();

// Only PayPal is stubbed: every bound below is checked by our own code
// against the stored item, which is the thing being tested.
vi.mock("../src/server/lib/paypal", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/server/lib/paypal")>();
  return {
    ...actual,
    paypalConfigured: () => true,
    createOrder: async (input: { paymentId: string }) => ({
      orderId: `ORDER-${input.paymentId}`,
      status: "CREATED",
      approveUrl: null,
    }),
  };
});

describe.skipIf(!available)("storefront (Postgres)", () => {
  let store: typeof import("../src/server/modules/storefront/storefront.service");
  let builder: typeof import("../src/server/modules/agents/builder.agent");
  let payments: typeof import("../src/server/modules/payments/payments.service");
  let db: typeof import("../src/server/db/client");
  let temp: IsolatedDb;

  const answering = (json: unknown) => ({
    ask: async () => ({
      json,
      model: "claude-opus-5-5",
      promptVersion: "test",
    }),
  });

  const shop = (over: Record<string, unknown> = {}) => ({
    slug: "kopi-senja",
    title: "Kopi Senja",
    blurb: "Beans roasted on Fridays",
    template: "shelf",
    products: [
      { name: "Flat white", description: "One cup", price: "4.50" },
      { name: "Bag of beans", description: "250g", price: "18.00" },
    ],
    ...over,
  });

  beforeAll(async () => {
    temp = await createTestDb();
    process.env.DATABASE_URL = temp.url;
    db = await import("../src/server/db/client");
    store = await import("../src/server/modules/storefront/storefront.service");
    builder = await import("../src/server/modules/agents/builder.agent");
    payments = await import("../src/server/modules/payments/payments.service");
  });

  afterAll(async () => {
    await db?.closeDb();
    await temp?.dispose();
  });

  it("writes a draft that the public cannot see yet", async () => {
    const draft = await store.createStorefront("shop", {
      slug: "draft-shop",
      title: "Draft",
      blurb: "",
      template: "shelf",
      currency: "USD",
      products: [{ name: "Thing", description: "", price: "1000" }],
    });
    expect(draft.state).toBe("draft");
    expect(await store.publishedStorefront("draft-shop")).toBeNull();

    await store.setPublished("shop", draft.id, true);
    expect(await store.publishedStorefront("draft-shop")).toMatchObject({
      state: "published",
      title: "Draft",
    });

    // Items get ids of their own, so a payment names one unambiguously.
    const live = await store.publishedStorefront("draft-shop");
    expect(live?.products[0]?.id).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(
      await store.publishedProduct("draft-shop", live?.products[0]?.id ?? ""),
    ).toMatchObject({ product: { name: "Thing" } });
  });

  it("serves the sanitised copy and keeps the author's own markup back", async () => {
    const shop = await store.createStorefront("shop", {
      slug: "html-shop",
      title: "Notes",
      blurb: "",
      template: "shelf",
      currency: "USD",
      html: '<p>Hi<script>alert(1)</script></p><p onclick="x()">Bye</p>',
      products: [{ name: "Thing", description: "", price: "1000" }],
    });
    // The owner sees both: what they wrote, and what it became.
    expect(shop.html).toContain("<script>");
    expect(shop.htmlClean).not.toContain("<script>");
    expect(shop.htmlClean).not.toContain("onclick");

    await store.setPublished("shop", shop.id, true);
    const live = await store.publishedStorefront("html-shop");
    expect(live?.htmlClean).toContain("Hi");
    // A visitor is never handed the draft, so no client bug can render it.
    expect(live && "html" in live).toBe(false);
  });

  it("keeps an address to one shop", async () => {
    await expect(
      store.createStorefront("other", {
        slug: "draft-shop",
        title: "Mine now",
        blurb: "",
        template: "shelf",
        currency: "USD",
        products: [{ name: "Thing", description: "", price: "100" }],
      }),
    ).rejects.toThrow(/already in use/);
  });

  it("writes a shop from a description, as a draft", async () => {
    const run = await builder.runBuilder(
      "shop",
      "A coffee roastery in Bandung. Beans by the bag and a flat white.",
      answering(shop()),
    );
    expect(run.storefront).toMatchObject({
      slug: "kopi-senja",
      state: "draft",
      writtenBy: "builder-agent",
    });
    expect(run.storefront.products).toHaveLength(2);
    expect(run.model).toContain("claude-opus-5-5");
    // Nothing is public until the owner says so.
    expect(await store.publishedStorefront("kopi-senja")).toBeNull();
  });

  it("refuses an address it has already used", async () => {
    await expect(
      builder.runBuilder("shop", "The same roastery again", answering(shop())),
    ).rejects.toThrow(/already one of your addresses/);
  });

  it("refuses an address the app keeps for itself", async () => {
    // Caught by the shared schema, not by a check of the agent's own: the
    // hand editor has to be stopped by the same rule.
    await expect(
      builder.runBuilder(
        "shop",
        "A shop called admin",
        answering(shop({ slug: "admin" })),
      ),
    ).rejects.toThrow(/will not store/);
  });

  it("refuses a tip jar that came back with prices on it", async () => {
    await expect(
      builder.runBuilder(
        "shop",
        "Just a tip jar for the band",
        answering(
          shop({
            slug: "tip-jar",
            template: "tip",
            products: [{ name: "Tip", description: "", price: "5.00" }],
          }),
        ),
      ),
    ).rejects.toThrow(/will not store/);
  });

  it("refuses prices that are not money", async () => {
    for (const price of ["4.555", "-2.00", "1,500", "free"])
      await expect(
        builder.runBuilder(
          "shop",
          "A shop with one odd price",
          answering(
            shop({
              slug: `odd-${price.replace(/\W/g, "")}`,
              products: [{ name: "Thing", description: "", price }],
            }),
          ),
        ),
      ).rejects.toThrow(/will not store/);
  });

  it("refuses a shop with nothing in it, and one with too much", async () => {
    await expect(
      builder.runBuilder(
        "shop",
        "An empty shop",
        answering(shop({ slug: "empty", products: [] })),
      ),
    ).rejects.toThrow(/will not store/);

    await expect(
      builder.runBuilder(
        "shop",
        "A very large shop",
        answering(
          shop({
            slug: "too-much",
            products: Array.from({ length: 13 }, (_, i) => ({
              name: `Thing ${i}`,
              description: "",
              price: "1.00",
            })),
          }),
        ),
      ),
    ).rejects.toThrow(/will not store/);
  });

  it("asks for more than a couple of words before it starts", async () => {
    await expect(
      builder.runBuilder("shop", "coffee", answering(shop())),
    ).rejects.toThrow(/a little more/);
  });

  // ----------------------------------------- changing one that exists

  describe("changing a shop that exists", () => {
    const made = async (over: Record<string, unknown> = {}) =>
      store.createStorefront("editor", {
        slug: `e-${Math.random().toString(36).slice(2, 8)}`,
        title: "Kopi Senja",
        blurb: "Beans roasted on Fridays",
        template: "shelf",
        currency: "USD",
        html: "<h2>About</h2>\n<p>We roast on Fridays.</p>",
        products: [{ name: "Beans", description: "250g", price: "1800" }],
        ...over,
      });

    const answersWith = (...blocks: Record<string, unknown>[]) =>
      answering({ blocks });

    it("proposes a page and writes nothing until it is applied", async () => {
      const shop = await made();
      const run = await builder.runShopEdit(
        "editor",
        shop.id,
        "Add a question about shipping",
        answersWith(
          { kind: "heading", text: "About", big: true },
          { kind: "text", text: "We roast on Fridays." },
          {
            kind: "faq",
            pairs: [{ a: "When does it ship?", b: "Within two days." }],
          },
        ),
      );

      expect(run.after.map((b) => b.kind)).toEqual(["heading", "text", "faq"]);
      expect(run.html).toContain("When does it ship?");
      // The shop itself is untouched: a proposal is not a save.
      const [stored] = (await store.listStorefronts("editor")).filter(
        (one) => one.id === shop.id,
      );
      expect(stored?.htmlClean).not.toContain("When does it ship?");

      // Applying it is the owner's own act, and it goes down the one road
      // a save already takes — there is no second write path for an agent.
    });

    it("cannot lose the owner's own markup by leaving it out", async () => {
      // The agent has no block that means "someone's hand-written design",
      // so an answer that simply omitted it would delete one. The rule is
      // in code, not in the prompt.
      const design = '<div class="ft-stage"><h2>A whole design</h2></div>';
      const shop = await made({ html: design });
      const run = await builder.runShopEdit(
        "editor",
        shop.id,
        "Add a line about delivery",
        answersWith({ kind: "text", text: "We deliver on Mondays." }),
      );
      expect(run.html).toContain("ft-stage");
      expect(run.html).toContain("We deliver on Mondays.");
    });

    it("carries on from the page you were shown, not the one on the server", async () => {
      // The second thing anyone says is "shorter", and that has to mean the
      // page they were just looking at. Without this a follow-up silently
      // threw the first answer away and started again from the save.
      const shop = await made({ html: "<p>What is saved.</p>" });
      const seen: string[] = [];
      const watching = {
        ask: async (input: { prompt: string }) => {
          seen.push(input.prompt);
          return {
            json: { blocks: [{ kind: "text", text: "Shorter." }] },
            model: "claude-opus-5-5",
            promptVersion: "test",
          };
        },
      };

      await builder.runShopEdit("editor", shop.id, "Shorten it", watching);
      expect(seen[0]).toContain("What is saved.");

      await builder.runShopEdit("editor", shop.id, "Shorten it again", {
        ...watching,
        from: "<p>What you were just shown.</p>",
      });
      expect(seen[1]).toContain("What you were just shown.");
      expect(seen[1]).not.toContain("What is saved.");
    });

    it("sanitises the page a follow-up starts from, because it came from a browser", async () => {
      const shop = await made();
      const run = await builder.runShopEdit("editor", shop.id, "Keep going", {
        ...answersWith({ kind: "text", text: "Fine." }),
        from: "<p>Kept.</p><script>alert(1)</script>",
      });
      // The script never becomes a block, so it can never be put back by
      // the merge and handed to the owner to apply.
      expect(run.html).not.toContain("<script");
      expect(run.before.some((b) => b.kind === "html")).toBe(false);
    });

    it("reports the addresses its page would send people to", async () => {
      const shop = await made();
      const run = await builder.runShopEdit(
        "editor",
        shop.id,
        "Add a button",
        answersWith({
          kind: "cta",
          payLink: "this-shop",
          label: "Browse the shop",
        }),
      );
      expect(run.links).toEqual([
        {
          href: expect.stringContaining(`/shop/${shop.slug}`),
          text: "Browse the shop",
        },
      ]);
    });

    it("refuses a button the Builder was not shown an address for", async () => {
      const shop = await made();
      await expect(
        builder.runShopEdit(
          "editor",
          shop.id,
          "Put a buy button on it",
          answersWith({ kind: "cta", payLink: "link-made-up", label: "Buy" }),
        ),
      ).rejects.toThrow(/not one of your addresses/);
    });

    it("refuses an empty answer rather than wiping the page", async () => {
      const shop = await made();
      await expect(
        builder.runShopEdit(
          "editor",
          shop.id,
          "Tidy it up",
          answering({ blocks: [] }),
        ),
      ).rejects.toThrow(/will not store/);
    });

    it("will not touch a shop that is not yours", async () => {
      const shop = await made();
      await expect(
        builder.runShopEdit(
          "someone-else",
          shop.id,
          "Change it",
          answersWith({ kind: "text", text: "Mine now." }),
        ),
      ).rejects.toThrow(/not one of yours/);
    });

    it("finds what is wrong with no model involved at all", async () => {
      // No `ask` is passed: `reviewShop` never reaches one.
      const shop = await made({
        html: '<p><a class="shop-cta" href="https://example.com/pay">Buy</a></p>',
      });
      const review = await builder.reviewShop("editor", shop.id);
      expect(review.findings.map((f) => f.id)).toContain("dead-button");
    });

    it("fixes only a finding this page is actually flagged for", async () => {
      const shop = await made();
      await expect(
        builder.runShopFix(
          "editor",
          shop.id,
          "no-way-to-pay",
          answersWith({ kind: "text", text: "x" }),
        ),
      ).rejects.toThrow(/not something this page is currently flagged for/);
    });

    it("says plainly when a finding is the owner's to fix, not the Builder's", async () => {
      const shop = await made({
        products: [{ name: "Beans", description: "", price: null }],
      });
      const review = await builder.reviewShop("editor", shop.id);
      expect(review.findings.map((f) => f.id)).toContain("unpriced-item");
      await expect(
        builder.runShopFix(
          "editor",
          shop.id,
          "unpriced-item",
          answersWith({ kind: "text", text: "x" }),
        ),
      ).rejects.toThrow(/yours to do, not the Builder's/);
    });
  });

  it("points at a price far above anything charged before", () => {
    const prior = [1_000n, 2_000n, 3_000n]; // median $20.00
    expect(
      builder.oddPrices(
        [
          { name: "Normal", price: "25.00" },
          { name: "Eyebrow-raiser", price: "900.00" },
          { name: "Tip", price: null },
        ],
        prior,
      ),
    ).toEqual(["Eyebrow-raiser"]);
    // With no history there is nothing to compare against, so nothing is said.
    expect(builder.oddPrices([{ name: "Any", price: "900.00" }], [])).toEqual(
      [],
    );
  });

  describe("what a payer may ask for", () => {
    let slug: string;
    let fixed: string;
    let open: string;
    let gone: string;

    beforeAll(async () => {
      slug = "guarded-shop";
      const shop = await store.createStorefront("shop", {
        slug,
        title: "Guarded",
        blurb: "",
        template: "shelf",
        theme: "paper",
        accent: "clay",
        currency: "USD",
        products: [
          {
            name: "Mug",
            description: "",
            price: "2000",
            min: null,
            max: null,
            quantity: true,
            limit: 3,
            soldOut: false,
          },
          {
            name: "Tip",
            description: "",
            price: null,
            min: "200",
            max: "5000",
            quantity: false,
            limit: 1,
            soldOut: false,
          },
          {
            name: "Workshop",
            description: "",
            price: "10000",
            min: null,
            max: null,
            quantity: false,
            limit: 1,
            soldOut: true,
          },
        ],
      });
      await store.setPublished("shop", shop.id, true);
      const live = await store.publishedStorefront(slug);
      fixed = live?.products[0]?.id ?? "";
      open = live?.products[1]?.id ?? "";
      gone = live?.products[2]?.id ?? "";
    });

    it("sells what is for sale", async () => {
      const order = await payments.startStorefrontOrder({
        slug,
        productId: fixed,
        quantity: 2,
      });
      expect(order.amountMinor).toBe("4000"); // two mugs
    });

    it("refuses what is sold out", async () => {
      await expect(
        payments.startStorefrontOrder({ slug, productId: gone }),
      ).rejects.toThrow(/sold out/);
    });

    it("refuses more than the item's own limit, whatever is asked for", async () => {
      await expect(
        payments.startStorefrontOrder({ slug, productId: fixed, quantity: 4 }),
      ).rejects.toThrow(/at most 3/);
      await expect(
        payments.startStorefrontOrder({
          slug,
          productId: fixed,
          quantity: 999,
        }),
      ).rejects.toThrow(/at most 3/);
    });

    it("ignores a count on an item that is not sold by the number", async () => {
      const order = await payments.startStorefrontOrder({
        slug,
        productId: open,
        amount: "5.00",
        quantity: 50,
      });
      expect(order.amountMinor).toBe("500"); // one, not fifty
    });

    it("holds a payer-named amount to the shop's bounds", async () => {
      await expect(
        payments.startStorefrontOrder({
          slug,
          productId: open,
          amount: "1.00",
        }),
      ).rejects.toThrow(/least for this is \$2\.00/);
      await expect(
        payments.startStorefrontOrder({
          slug,
          productId: open,
          amount: "500.00",
        }),
      ).rejects.toThrow(/most for this is \$50\.00/);
      await expect(
        payments.startStorefrontOrder({ slug, productId: open, amount: "0" }),
      ).rejects.toThrow(/least for this|like 25\.00/);
    });

    it("refuses an amount that is not money at all", async () => {
      for (const amount of ["", "abc", "-5", "1.005", "1e9"])
        await expect(
          payments.startStorefrontOrder({ slug, productId: open, amount }),
        ).rejects.toThrow(/like 25\.00|least for this/);
    });

    it("caps any single order, however it is reached", async () => {
      const shop = await store.createStorefront("shop", {
        slug: "big-ticket",
        title: "Big",
        blurb: "",
        template: "shelf",
        theme: "paper",
        accent: "clay",
        currency: "USD",
        products: [
          {
            name: "Crate",
            description: "",
            price: "6000000",
            min: null,
            max: null,
            quantity: true,
            limit: 5,
            soldOut: false,
          },
        ],
      });
      await store.setPublished("shop", shop.id, true);
      const live = await store.publishedStorefront("big-ticket");
      const crate = live?.products[0]?.id ?? "";

      // One is fine; two passes $100,000.00 and is refused.
      await expect(
        payments.startStorefrontOrder({
          slug: "big-ticket",
          productId: crate,
          quantity: 1,
        }),
      ).resolves.toMatchObject({ amountMinor: "6000000" });
      await expect(
        payments.startStorefrontOrder({
          slug: "big-ticket",
          productId: crate,
          quantity: 2,
        }),
      ).rejects.toThrow(/cannot come to more than \$100,000\.00/);
    });

    it("refuses an item that is not on this shop", async () => {
      await expect(
        payments.startStorefrontOrder({ slug, productId: "deadbeef" }),
      ).rejects.toThrow(/No such item/);
      await expect(
        payments.startStorefrontOrder({ slug: "no-shop", productId: fixed }),
      ).rejects.toThrow(/No such item/);
    });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  type IsolatedDb,
  postgresAvailable,
} from "./helpers/pgTestDb";

// The storefront service and the Builder's eval set. The model is stubbed,
// so what is tested is the part that decides whether an answer may be
// stored — which is the schema the hand editor is held to as well.
const available = await postgresAvailable();

describe.skipIf(!available)("storefront (Postgres)", () => {
  let store: typeof import("../src/server/modules/storefront/storefront.service");
  let builder: typeof import("../src/server/modules/agents/builder.agent");
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
});

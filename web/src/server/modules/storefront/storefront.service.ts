import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type {
  StorefrontConfig,
  StorefrontView,
} from "../../../features/storefront/config";
import { newId } from "../../../lib/ids";
import {
  getDb,
  isUniqueViolation,
  type StorefrontProduct,
  type StorefrontRow,
  storefronts,
} from "../../db/client";
import { SlugTakenError, StorefrontNotFoundError } from "./storefront.errors";

// Storefronts are configuration, never markup: a row here is read by one
// renderer, so whatever wrote the row — a person or an agent — can only
// produce pages that renderer was built to show.

const toView = (row: StorefrontRow): StorefrontView => ({
  id: row.id,
  owner: row.owner,
  slug: row.slug,
  title: row.title,
  blurb: row.blurb,
  template: row.template,
  theme: row.theme,
  accent: row.accent as StorefrontView["accent"],
  currency: row.currency,
  state: row.state,
  writtenBy: row.writtenBy,
  products: row.products,
  updatedAt: row.updatedAt.toISOString(),
});

const withIds = (config: StorefrontConfig): StorefrontProduct[] =>
  config.products.map((product) => ({
    id: newId(8),
    name: product.name,
    description: product.description,
    priceMinor: product.price,
  }));

/** Writes a new storefront as a draft. Publishing is a separate, owner act. */
export async function createStorefront(
  owner: string,
  config: StorefrontConfig,
  writtenBy = "owner",
): Promise<StorefrontView> {
  try {
    const [row] = await getDb()
      .insert(storefronts)
      .values({
        id: newId(),
        owner,
        slug: config.slug,
        title: config.title,
        blurb: config.blurb,
        template: config.template,
        theme: config.theme,
        accent: config.accent,
        currency: config.currency,
        products: withIds(config),
        state: "draft",
        writtenBy,
      })
      .returning();
    return toView(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new SlugTakenError();
    throw error;
  }
}

/** Replaces the configuration of one storefront, keeping its state. */
export async function updateStorefront(
  owner: string,
  id: string,
  config: StorefrontConfig,
  writtenBy = "owner",
): Promise<StorefrontView> {
  try {
    const [row] = await getDb()
      .update(storefronts)
      .set({
        slug: config.slug,
        title: config.title,
        blurb: config.blurb,
        template: config.template,
        theme: config.theme,
        accent: config.accent,
        currency: config.currency,
        products: withIds(config),
        writtenBy,
        updatedAt: new Date(),
      })
      .where(and(eq(storefronts.id, id), eq(storefronts.owner, owner)))
      .returning();
    if (!row) throw new StorefrontNotFoundError();
    return toView(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new SlugTakenError();
    throw error;
  }
}

export async function setPublished(
  owner: string,
  id: string,
  published: boolean,
): Promise<StorefrontView> {
  const [row] = await getDb()
    .update(storefronts)
    .set({ state: published ? "published" : "draft", updatedAt: new Date() })
    .where(and(eq(storefronts.id, id), eq(storefronts.owner, owner)))
    .returning();
  if (!row) throw new StorefrontNotFoundError();
  return toView(row);
}

export async function listStorefronts(
  owner: string,
): Promise<StorefrontView[]> {
  const rows = await getDb()
    .select()
    .from(storefronts)
    .where(eq(storefronts.owner, owner))
    .orderBy(desc(storefronts.updatedAt));
  return rows.map(toView);
}

/** The public page. A draft resolves to nothing, whoever asks. */
export async function publishedStorefront(
  slug: string,
): Promise<StorefrontView | null> {
  const [row] = await getDb()
    .select()
    .from(storefronts)
    .where(and(eq(storefronts.slug, slug), eq(storefronts.state, "published")))
    .limit(1);
  return row ? toView(row) : null;
}

/** One product of a published storefront, for taking a payment for it. */
export async function publishedProduct(
  slug: string,
  productId: string,
): Promise<{
  storefront: StorefrontView;
  product: StorefrontProduct;
} | null> {
  const storefront = await publishedStorefront(slug);
  if (!storefront) return null;
  const product = storefront.products.find((item) => item.id === productId);
  return product ? { storefront, product } : null;
}

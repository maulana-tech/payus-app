import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getServerEnv } from "../../../env.server";
import {
  SIGNATURE_HEADER,
  signWebhook,
} from "../../../features/developer/signature";
import { apiKeys, getDb, webhookDeliveries, webhooks } from "../../db/client";
import {
  ApiKeyNotFoundError,
  InvalidWebhookUrlError,
} from "./developer.errors";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ---- API keys --------------------------------------------------------------
// Format: payus_sk_<12 hex id>_<secret>. Only sha256(key) is stored.

export async function createApiKey(owner: string, name: string) {
  const id = randomBytes(6).toString("hex");
  const key = `payus_sk_${id}_${randomBytes(24).toString("base64url")}`;
  const now = new Date();
  await getDb()
    .insert(apiKeys)
    .values({
      id,
      owner,
      name,
      secretHash: sha256(key),
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    });
  return { id, name, key, createdAt: now.toISOString() };
}

export async function listApiKeys(owner: string) {
  const rows = await getDb()
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.owner, owner), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    preview: `payus_sk_${row.id}_…`,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }));
}

export async function revokeApiKey(owner: string, id: string) {
  const revoked = await getDb()
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, id),
        eq(apiKeys.owner, owner),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id });
  if (!revoked.length) throw new ApiKeyNotFoundError();
}

/** Owner of a valid, unrevoked key from an `Authorization: Bearer` header. */
export async function authenticateApiKey(
  header: string | null,
): Promise<{ owner: string; keyId: string } | null> {
  const key = header?.match(
    /^Bearer (payus_sk_([0-9a-f]{12})_[A-Za-z0-9_-]{32})$/,
  );
  if (!key) return null;
  const db = getDb();
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, key[2]), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  const given = Buffer.from(sha256(key[1]));
  const stored = Buffer.from(row.secretHash);
  if (given.length !== stored.length || !timingSafeEqual(given, stored))
    return null;
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id));
  return { owner: row.owner, keyId: row.id };
}

// ---- Webhooks --------------------------------------------------------------

// Literal private, loopback and link-local hosts are refused in production
// so a webhook can't be pointed at the server's own network. (A hostname
// that resolves to one is not caught here; run the app with egress rules.)
const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|\[?fe80:)/i;

function validWebhookUrl(url: string) {
  try {
    const u = new URL(url);
    const production = getServerEnv().NODE_ENV === "production";
    if (u.protocol === "https:")
      return !(production && PRIVATE_HOST.test(u.hostname));
    return (
      !production &&
      u.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(u.hostname)
    );
  } catch {
    return false;
  }
}

async function findWebhook(owner: string) {
  const [row] = await getDb()
    .select()
    .from(webhooks)
    .where(eq(webhooks.owner, owner))
    .limit(1);
  return row ?? null;
}

export async function setWebhook(owner: string, url: string) {
  if (!validWebhookUrl(url)) throw new InvalidWebhookUrlError();
  const db = getDb();
  const now = new Date();
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  // An endpoint keeps its secret when it is only re-pointed, so merchants
  // don't have to redeploy their verifier to change the URL.
  const [row] = await db
    .insert(webhooks)
    .values({ owner, url, secret, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: webhooks.owner,
      set: { url, updatedAt: now },
    })
    .returning();
  return { url: row.url, secret: row.secret };
}

export async function rotateWebhookSecret(owner: string) {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const rotated = await getDb()
    .update(webhooks)
    .set({ secret, updatedAt: new Date() })
    .where(eq(webhooks.owner, owner))
    .returning({ owner: webhooks.owner });
  if (!rotated.length) throw new InvalidWebhookUrlError();
  return { secret };
}

export async function deleteWebhook(owner: string) {
  await getDb().delete(webhooks).where(eq(webhooks.owner, owner));
}

export async function getWebhook(owner: string) {
  const row = await findWebhook(owner);
  return row ? { url: row.url, secret: row.secret } : null;
}

export async function listDeliveries(owner: string) {
  const rows = await getDb()
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.owner, owner))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(20);
  return rows.map((row) => ({
    id: row.id,
    event: row.event,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.responseStatus,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  }));
}

const RETRY_DELAYS_MS = [0, 2_000, 8_000];

/**
 * POSTs a signed event to the owner's endpoint, retrying a failure twice.
 * Best effort: a delivery log lets the owner see what happened.
 */
export async function deliverEvent(
  owner: string,
  type: string,
  data: unknown,
  sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
) {
  const hook = await findWebhook(owner);
  if (!hook) return null;
  const id = `evt_${randomBytes(12).toString("hex")}`;
  const body = JSON.stringify({
    id,
    type,
    created: Math.floor(Date.now() / 1000),
    data,
  });
  let attempts = 0;
  let responseStatus: number | null = null;
  let error: string | null = null;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await sleep(delay);
    attempts++;
    try {
      const res = await fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Payus-Webhooks/1",
          [SIGNATURE_HEADER]: signWebhook(hook.secret, body),
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      });
      responseStatus = res.status;
      if (res.ok) {
        error = null;
        break;
      }
      error = `HTTP ${res.status}`;
    } catch (e) {
      responseStatus = null;
      error = e instanceof Error ? e.message : "request failed";
    }
  }
  const delivery = {
    id,
    owner,
    event: type,
    status: error ? ("failed" as const) : ("delivered" as const),
    attempts,
    responseStatus,
    error,
    createdAt: new Date(),
  };
  await getDb().insert(webhookDeliveries).values(delivery);
  return delivery;
}

import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "../../../env.server";
import {
  SIGNATURE_HEADER,
  signWebhook,
} from "../../../features/developer/signature";
import { getApiKeys, getWebhookDeliveries, getWebhooks } from "../../db/mongo";
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
  await (await getApiKeys()).insertOne({
    _id: id,
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
  const docs = await (await getApiKeys())
    .find({ owner, revokedAt: null })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map((d) => ({
    id: d._id,
    name: d.name,
    preview: `payus_sk_${d._id}_…`,
    createdAt: d.createdAt.toISOString(),
    lastUsedAt: d.lastUsedAt?.toISOString() ?? null,
  }));
}

export async function revokeApiKey(owner: string, id: string) {
  const res = await (await getApiKeys()).updateOne(
    { _id: id, owner, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  if (!res.matchedCount) throw new ApiKeyNotFoundError();
}

/** Owner of a valid, unrevoked key from an `Authorization: Bearer` header. */
export async function authenticateApiKey(
  header: string | null,
): Promise<{ owner: string; keyId: string } | null> {
  const key = header?.match(
    /^Bearer (payus_sk_([0-9a-f]{12})_[A-Za-z0-9_-]{32})$/,
  );
  if (!key) return null;
  const keys = await getApiKeys();
  const doc = await keys.findOne({ _id: key[2], revokedAt: null });
  if (!doc) return null;
  const given = Buffer.from(sha256(key[1]));
  const stored = Buffer.from(doc.secretHash);
  if (given.length !== stored.length || !timingSafeEqual(given, stored))
    return null;
  void keys.updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date() } });
  return { owner: doc.owner, keyId: doc._id };
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

export async function setWebhook(owner: string, url: string) {
  if (!validWebhookUrl(url)) throw new InvalidWebhookUrlError();
  const hooks = await getWebhooks();
  const now = new Date();
  const existing = await hooks.findOne({ _id: owner });
  const secret =
    existing?.secret ?? `whsec_${randomBytes(24).toString("base64url")}`;
  await hooks.updateOne(
    { _id: owner },
    {
      $set: { url, secret, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
  return { url, secret };
}

export async function rotateWebhookSecret(owner: string) {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const res = await (await getWebhooks()).updateOne(
    { _id: owner },
    { $set: { secret, updatedAt: new Date() } },
  );
  if (!res.matchedCount) throw new InvalidWebhookUrlError();
  return { secret };
}

export async function deleteWebhook(owner: string) {
  await (await getWebhooks()).deleteOne({ _id: owner });
}

export async function getWebhook(owner: string) {
  const doc = await (await getWebhooks()).findOne({ _id: owner });
  return doc ? { url: doc.url, secret: doc.secret } : null;
}

export async function listDeliveries(owner: string) {
  const docs = await (await getWebhookDeliveries())
    .find({ owner })
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();
  return docs.map((d) => ({
    id: d._id,
    event: d.event,
    status: d.status,
    attempts: d.attempts,
    responseStatus: d.responseStatus,
    error: d.error,
    createdAt: d.createdAt.toISOString(),
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
  const hook = await (await getWebhooks()).findOne({ _id: owner });
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
    _id: id,
    owner,
    event: type,
    status: error ? ("failed" as const) : ("delivered" as const),
    attempts,
    responseStatus,
    error,
    createdAt: new Date(),
  };
  await (await getWebhookDeliveries()).insertOne(delivery);
  return delivery;
}

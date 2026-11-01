import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyWebhook } from "../src/features/developer/signature";
import { profileSigningSeed } from "../src/lib/derive";
import { signingPubkeyHex } from "../src/lib/signing";
import {
  canonicalClaim,
  signClaim,
  type UsernameClaim,
} from "../src/lib/usernameClaim";

// The merchant Checkout API end to end against a real MongoDB (skipped when
// none is reachable): keys, the REST routes and signed webhooks to a local
// HTTP server.
const URI = process.env.PAYUS_TEST_MONGODB_URI ?? "mongodb://localhost:27017";
const DB = `payus_test_${randomUUID().replaceAll("-", "")}`;
const { mongoAvailable } = await import("./helpers/mongoTestDb");
const available = await mongoAvailable();

const seed = profileSigningSeed(new Uint8Array(32).fill(4));
const profile: UsernameClaim = {
  v: 1,
  username: "shop",
  signPubkeyHex: signingPubkeyHex(seed),
  msgPubkeyHex: "ab".repeat(32),
  issuedAt: "2026-10-15T00:00:00.000Z",
};

describe.skipIf(!available)("checkout API (MongoDB)", () => {
  let dev: typeof import("../src/server/modules/developer/developer.service");
  let invoices: typeof import("../src/server/modules/invoices/invoices.service");
  let checkoutsRoute: typeof import("../src/app/api/v1/checkouts/route");
  let checkoutRoute: typeof import("../src/app/api/v1/checkouts/[id]/route");
  let mongo: typeof import("../src/server/db/mongo");
  let server: Server;
  let hookUrl = "";
  const received: { body: string; signature: string }[] = [];
  let failNext = 0;

  beforeAll(async () => {
    process.env.MONGODB_URI = `${URI.replace(/\/$/, "")}/${DB}`;
    mongo = await import("../src/server/db/mongo");
    dev = await import("../src/server/modules/developer/developer.service");
    invoices = await import("../src/server/modules/invoices/invoices.service");
    checkoutsRoute = await import("../src/app/api/v1/checkouts/route");
    checkoutRoute = await import("../src/app/api/v1/checkouts/[id]/route");
    await (await mongo.getProfiles()).insertOne({
      _id: "shop",
      userId: "u-shop",
      signPubkeyHex: profile.signPubkeyHex,
      msgPubkeyHex: profile.msgPubkeyHex,
      claimJson: canonicalClaim(profile),
      claimSigHex: signClaim(profile, seed),
      createdAt: new Date(),
    });
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        if (failNext > 0) {
          failNext--;
          res.writeHead(500).end();
          return;
        }
        received.push({
          body,
          signature: String(req.headers["payus-signature"]),
        });
        res.writeHead(200).end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  });

  afterAll(async () => {
    server?.close();
    const db = await mongo.getDb();
    if (db.databaseName.startsWith("payus_test_")) await db.dropDatabase();
  });

  const post = (key: string | null, body: unknown) =>
    checkoutsRoute.POST(
      new Request("http://payus.test/api/v1/checkouts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    );

  it("authenticates keys and stops revoked ones", async () => {
    const { key, id } = await dev.createApiKey("shop", "test");
    expect(key).toMatch(/^payus_sk_[0-9a-f]{12}_[A-Za-z0-9_-]{32}$/);
    expect(await dev.authenticateApiKey(`Bearer ${key}`)).toMatchObject({
      owner: "shop",
    });
    expect(await dev.authenticateApiKey(`Bearer ${key}x`)).toBeNull();
    expect(
      await dev.authenticateApiKey(`Bearer ${key.slice(0, -1)}A`),
    ).toBeNull();
    await dev.revokeApiKey("shop", id);
    expect(await dev.authenticateApiKey(`Bearer ${key}`)).toBeNull();
    expect((await post(key, { amount: "1" })).status).toBe(401);
  });

  it("creates checkouts and reads them back", async () => {
    const { key } = await dev.createApiKey("shop", "server");

    const bad = await post(key, { amount: "1.234" });
    expect(bad.status).toBe(400);
    expect((await post(key, { amount: "1", junk: true })).status).toBe(400);

    const res = await post(key, {
      amount: "25.00",
      reference: "order_1042",
      description: "Coffee x2",
    });
    expect(res.status).toBe(201);
    const checkout = await res.json();
    expect(checkout).toMatchObject({
      object: "checkout",
      status: "open",
      currency: "USD",
      amount: "25.00",
      amount_minor: "2500",
      paid_minor: "0",
      reference: "order_1042",
    });
    expect(checkout.url).toMatch(/\/i\/[A-Za-z0-9_-]{32}$/);

    const got = await checkoutRoute.GET(
      new Request(`http://payus.test/api/v1/checkouts/${checkout.id}`, {
        headers: { Authorization: `Bearer ${key}` },
      }),
      { params: Promise.resolve({ id: checkout.id }) },
    );
    expect((await got.json()).id).toBe(checkout.id);
  });

  it("signs webhooks and retries failures", async () => {
    const { secret } = await dev.setWebhook("shop", hookUrl);
    const inv = await invoices.createInvoice("shop", {
      number: "WH-1",
      clientName: "A",
      clientEmail: null,
      dueDate: "2026-12-01",
      notes: "",
      items: [{ description: "x", quantity: 1, unitPrice: "1" }],
      source: "api",
      reference: "order_7",
    });
    const noSleep = async () => {};
    failNext = 2; // two 500s, then success on the third try
    const delivery = await dev.deliverEvent(
      "shop",
      "checkout.paid",
      { id: inv.id, reference: "order_7" },
      noSleep,
    );
    expect(delivery).toMatchObject({ status: "delivered", attempts: 3 });
    const last = received.at(-1);
    expect(last && verifyWebhook(secret, last.body, last.signature)).toBe(true);
    expect(JSON.parse(last?.body ?? "{}")).toMatchObject({
      type: "checkout.paid",
      data: { reference: "order_7" },
    });

    failNext = 3;
    const failed = await dev.deliverEvent("shop", "test", {}, noSleep);
    expect(failed).toMatchObject({ status: "failed", attempts: 3 });
    await expect(dev.setWebhook("shop", "ftp://nope")).rejects.toThrow();
  });
});

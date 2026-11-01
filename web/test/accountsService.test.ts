import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Account type against a real MongoDB (skipped when none is reachable).
const URI = process.env.PAYUS_TEST_MONGODB_URI ?? "mongodb://localhost:27017";
const DB = `payus_test_${randomUUID().replaceAll("-", "")}`;

const { mongoAvailable } = await import("./helpers/mongoTestDb");
const available = await mongoAvailable();

describe.skipIf(!available)("account type (MongoDB)", () => {
  let service: typeof import("../src/server/modules/accounts/accounts.service");
  let mongo: typeof import("../src/server/db/mongo");

  beforeAll(async () => {
    process.env.MONGODB_URI = `${URI.replace(/\/$/, "")}/${DB}`;
    mongo = await import("../src/server/db/mongo");
    service = await import("../src/server/modules/accounts/accounts.service");
  });

  afterAll(async () => {
    const db = await mongo.getDb();
    if (db.databaseName.startsWith("payus_test_")) await db.dropDatabase();
  });

  it("is unset until chosen", async () => {
    const me = await service.me("u-new");
    expect(me).toMatchObject({ accountType: null, businessName: null });
  });

  it("saves the type and keeps a name only for businesses", async () => {
    await service.setAccountType("u1", {
      accountType: "business",
      businessName: "Kopi Senja",
    });
    expect(await service.me("u1")).toMatchObject({
      accountType: "business",
      businessName: "Kopi Senja",
    });

    await service.setAccountType("u1", {
      accountType: "personal",
      businessName: "ignored",
    });
    expect(await service.me("u1")).toMatchObject({
      accountType: "personal",
      businessName: null,
    });
  });
});

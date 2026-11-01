import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  type IsolatedDb,
  postgresAvailable,
} from "./helpers/pgTestDb";

// Account type against a real Postgres (skipped when none is reachable).
const available = await postgresAvailable();

describe.skipIf(!available)("account type (Postgres)", () => {
  let service: typeof import("../src/server/modules/accounts/accounts.service");
  let temp: IsolatedDb;

  beforeAll(async () => {
    temp = await createTestDb();
    process.env.DATABASE_URL = temp.url;
    service = await import("../src/server/modules/accounts/accounts.service");
  });

  afterAll(async () => {
    await temp?.dispose();
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

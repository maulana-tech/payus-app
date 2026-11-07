import { afterEach, beforeEach, describe, expect, it } from "vitest";

// `getServerEnv()` is called by every request that reads any setting, and it
// parses rather than reads: a value it refuses is a thrown error, and a
// thrown error there is a 500 on the whole API.
//
// That makes the enum variables the dangerous ones. They are typed into a
// hosting dashboard by a person, and a box left empty arrives as `""`, not
// as absent — which zod's enum refuses. One empty box took every tRPC call
// down with a 500 in production, for a variable that was not even in use.

const KEYS = [
  "PAYPAL_ENV",
  "ANTHROPIC_BACKEND",
  "NODE_ENV",
  "DATABASE_URL",
] as const;

describe("server env", () => {
  let before: Partial<Record<(typeof KEYS)[number], string | undefined>>;
  let getServerEnv: () => { PAYPAL_ENV: string; ANTHROPIC_BACKEND?: string };

  beforeEach(async () => {
    before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    ({ getServerEnv } = await import("../src/env.server"));
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });

  it("treats an empty box as an unset one", () => {
    process.env.PAYPAL_ENV = "";
    process.env.ANTHROPIC_BACKEND = "";
    expect(() => getServerEnv()).not.toThrow();
    // And the default still applies, rather than the empty string winning.
    expect(getServerEnv().PAYPAL_ENV).toBe("sandbox");
    expect(getServerEnv().ANTHROPIC_BACKEND).toBeUndefined();
  });

  it("forgives a capital and a stray space, which a paste brings along", () => {
    process.env.PAYPAL_ENV = " Sandbox ";
    expect(getServerEnv().PAYPAL_ENV).toBe("sandbox");
    process.env.ANTHROPIC_BACKEND = "BEDROCK";
    expect(getServerEnv().ANTHROPIC_BACKEND).toBe("bedrock");
  });

  it("still refuses a value that means something else", () => {
    // Forgiving the shape of a value is not the same as forgiving the
    // value: `PAYPAL_ENV=production` must not quietly become sandbox.
    process.env.PAYPAL_ENV = "production";
    expect(() => getServerEnv()).toThrow();
  });

  it("reads live when live is what it says", () => {
    process.env.PAYPAL_ENV = "live";
    expect(getServerEnv().PAYPAL_ENV).toBe("live");
  });

  it("does not throw with nothing set at all", () => {
    for (const key of KEYS) delete process.env[key];
    expect(() => getServerEnv()).not.toThrow();
    expect(getServerEnv().PAYPAL_ENV).toBe("sandbox");
  });
});

import { describe, expect, it } from "vitest";
import { publicEnvSchema } from "../src/env";
import { serverEnvSchema } from "../src/env.server";

describe("environment schemas", () => {
  it("defaults NODE_ENV and keeps a blank Privy app id absent", () => {
    const parsed = publicEnvSchema.parse({ NEXT_PUBLIC_PRIVY_APP_ID: "  " });
    expect(parsed.NODE_ENV).toBe("development");
    expect(parsed.NEXT_PUBLIC_PRIVY_APP_ID).toBeUndefined();
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => publicEnvSchema.parse({ NODE_ENV: "staging" })).toThrow();
  });

  it("keeps blank optional secrets absent", () => {
    const parsed = serverEnvSchema.parse({
      NODE_ENV: "test",
      PRIVY_APP_SECRET: "  ",
    });
    expect(parsed.PRIVY_APP_SECRET).toBeUndefined();
  });
});

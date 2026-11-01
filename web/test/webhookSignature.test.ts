import { describe, expect, it } from "vitest";
import {
  signWebhook,
  verifyWebhook,
} from "../src/features/developer/signature";

describe("webhook signatures", () => {
  const body = JSON.stringify({ type: "checkout.paid", data: { id: "x" } });
  it("verifies a fresh signature", () => {
    const now = 1_800_000_000;
    expect(
      verifyWebhook("whsec", body, signWebhook("whsec", body, now), now),
    ).toBe(true);
  });
  it("rejects another secret, an edited body or a replay", () => {
    const now = 1_800_000_000;
    const header = signWebhook("whsec", body, now);
    expect(verifyWebhook("other", body, header, now)).toBe(false);
    expect(verifyWebhook("whsec", `${body} `, header, now)).toBe(false);
    expect(verifyWebhook("whsec", body, header, now + 301)).toBe(false);
    expect(verifyWebhook("whsec", body, "garbage", now)).toBe(false);
  });
});

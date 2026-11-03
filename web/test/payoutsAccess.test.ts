import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probePayoutsAccess, resetPaypalToken } from "../src/server/lib/paypal";

// Whether this account may send payouts is a question with a real answer,
// and we would rather ask PayPal than infer it from a flag. The probe reads
// a batch that cannot exist: the status code is the whole signal, so these
// are the mappings that matter.

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

function paypalReturning(status: number, body: unknown) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/v1/oauth2/token"))
      return reply(200, { access_token: "t", expires_in: 3600 });
    return reply(status, body);
  });
}

const env = { ...process.env };

beforeEach(() => {
  resetPaypalToken();
  process.env.PAYPAL_CLIENT_ID = "id";
  process.env.PAYPAL_CLIENT_SECRET = "secret";
  process.env.PAYPAL_ENV = "sandbox";
  process.env.PAYPAL_PAYOUTS_ENABLED = "true";
});

afterEach(() => {
  process.env = { ...env };
  vi.restoreAllMocks();
  resetPaypalToken();
});

describe("payouts access", () => {
  it("says nothing is configured before there are keys", async () => {
    process.env.PAYPAL_CLIENT_ID = "";
    process.env.PAYPAL_CLIENT_SECRET = "";
    expect(await probePayoutsAccess()).toEqual({ state: "not_configured" });
  });

  it("says off while the deployment has not switched payouts on", async () => {
    process.env.PAYPAL_PAYOUTS_ENABLED = "false";
    expect(await probePayoutsAccess()).toEqual({ state: "off" });
  });

  it("reads a 404 as the permission being there", async () => {
    vi.stubGlobal(
      "fetch",
      paypalReturning(404, { name: "RESOURCE_NOT_FOUND" }),
    );
    expect(await probePayoutsAccess()).toEqual({ state: "approved" });
  });

  it("reads a complaint about the id as the permission being there", async () => {
    vi.stubGlobal(
      "fetch",
      paypalReturning(400, { name: "INVALID_RESOURCE_ID" }),
    );
    expect(await probePayoutsAccess()).toEqual({ state: "approved" });
  });

  it("reads a 403 as refused, and keeps PayPal's own words", async () => {
    vi.stubGlobal(
      "fetch",
      paypalReturning(403, {
        name: "NOT_AUTHORIZED",
        message: "Authorization failed due to insufficient permissions.",
      }),
    );
    expect(await probePayoutsAccess()).toEqual({
      state: "denied",
      reason: "Authorization failed due to insufficient permissions.",
    });
  });

  it("does not guess when PayPal answers with something else", async () => {
    vi.stubGlobal("fetch", paypalReturning(500, { message: "Internal" }));
    const access = await probePayoutsAccess();
    expect(access.state).toBe("unknown");
  });
});

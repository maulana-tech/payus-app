import { describe, expect, it, vi } from "vitest";
import {
  constructEvent,
  Payus,
  PayusError,
  SignatureError,
  verifyWebhook,
} from "../../packages/js/src/index";
import { signWebhook } from "../src/features/developer/signature";

// The SDK is the other half of this application, so it is tested against
// this application: the signature it accepts is the one the server
// produces, from the same function the server uses. A library that agrees
// only with itself is the way this goes wrong.

const SECRET = "whsec_test";
const NOW = 1_800_000_000;

const event = JSON.stringify({
  id: "evt_1",
  type: "checkout.paid",
  created: NOW,
  data: { id: "chk_1", object: "checkout", reference: "order_1042" },
});

describe("@payus/js · webhooks", () => {
  it("verifies exactly what this server signs", async () => {
    const header = signWebhook(SECRET, event, NOW);
    expect(await verifyWebhook(SECRET, event, header, { now: NOW })).toBe(true);
  });

  it("rejects another secret, an edited body, and a replay", async () => {
    const header = signWebhook(SECRET, event, NOW);
    expect(await verifyWebhook("other", event, header, { now: NOW })).toBe(
      false,
    );
    expect(await verifyWebhook(SECRET, `${event} `, header, { now: NOW })).toBe(
      false,
    );
    expect(await verifyWebhook(SECRET, event, header, { now: NOW + 301 })).toBe(
      false,
    );
    expect(await verifyWebhook(SECRET, event, "garbage", { now: NOW })).toBe(
      false,
    );
    expect(await verifyWebhook(SECRET, event, null, { now: NOW })).toBe(false);
  });

  it("hands back the event only once it has checked it", async () => {
    const header = signWebhook(SECRET, event, NOW);
    const parsed = await constructEvent(SECRET, event, header, { now: NOW });
    expect(parsed.data.reference).toBe("order_1042");

    await expect(
      constructEvent(SECRET, event, "t=1,v1=00", { now: NOW }),
    ).rejects.toBeInstanceOf(SignatureError);
  });
});

describe("@payus/js · checkouts", () => {
  const checkout = {
    id: "chk_1",
    object: "checkout",
    status: "open",
    amount: "25.00",
    amount_minor: "2500",
  };

  it("sends the key and the body, and returns the checkout", async () => {
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe("https://pay.test/api/v1/checkouts");
        expect(init?.method).toBe("POST");
        const headers = (init?.headers ?? {}) as Record<string, string>;
        expect(headers.authorization).toBe("Bearer payus_sk_test");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          amount: "25.00",
        });
        return new Response(JSON.stringify(checkout), { status: 201 });
      },
    );

    const payus = new Payus({
      apiKey: "payus_sk_test",
      // A trailing slash is the kind of thing that should not matter.
      baseUrl: "https://pay.test/",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const made = await payus.createCheckout({
      amount: "25.00",
      reference: "order_1042",
    });
    expect(made.amount_minor).toBe("2500");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("turns the API's own error into one you can read", async () => {
    const payus = new Payus({
      apiKey: "payus_sk_test",
      baseUrl: "https://pay.test",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            error: { code: "invalid_request", message: "Enter an amount." },
          }),
          { status: 400 },
        )) as unknown as typeof fetch,
    });
    await expect(payus.createCheckout({ amount: "" })).rejects.toMatchObject({
      name: "PayusError",
      status: 400,
      code: "invalid_request",
      message: "Enter an amount.",
    });
    expect(new PayusError(400, "x", "y")).toBeInstanceOf(Error);
  });

  it("escapes the id it is given rather than pasting it into a URL", async () => {
    const seen: string[] = [];
    const payus = new Payus({
      apiKey: "payus_sk_test",
      baseUrl: "https://pay.test",
      fetch: (async (url: string) => {
        seen.push(String(url));
        return new Response(JSON.stringify(checkout), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await payus.getCheckout("../../admin");
    expect(seen[0]).toBe("https://pay.test/api/v1/checkouts/..%2F..%2Fadmin");
  });

  it("will not start without a key or a host", () => {
    expect(
      () => new Payus({ apiKey: "", baseUrl: "https://pay.test" }),
    ).toThrow(/API key/);
    expect(() => new Payus({ apiKey: "k", baseUrl: "" })).toThrow(/baseUrl/);
  });
});

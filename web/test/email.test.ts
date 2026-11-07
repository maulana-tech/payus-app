import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEmailHtml,
  buildEmailText,
  sendEmail,
} from "../src/server/lib/email";

describe("Email Transport and Templates", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Payus <test@payus.example>");
    vi.stubEnv("APP_URL", "https://app.payus.example");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
  });

  it("builds clean HTML without crypto leaks and includes unsubscribe link", () => {
    const html = buildEmailHtml({
      title: "Invoice Paid",
      message: "Invoice INV-001 has been settled: $0.80.",
      actionLabel: "View Invoices",
      actionUrl: "https://app.payus.example/invoices",
      unsubscribeUrl: "https://app.payus.example/unsubscribe/abc123token",
    });

    expect(html).toContain("Invoice Paid");
    expect(html).toContain("Invoice INV-001 has been settled: $0.80.");
    expect(html).toContain("https://app.payus.example/invoices");
    expect(html).toContain("https://app.payus.example/unsubscribe/abc123token");
    expect(html).not.toContain("0x");
  });

  it("builds HTML without optional action and unsubscribe links when omitted", () => {
    const html = buildEmailHtml({
      title: "Simple Notification",
      message: "Here is your update.",
    });

    expect(html).toContain("Simple Notification");
    expect(html).toContain("Here is your update.");
    expect(html).not.toContain("Unsubscribe from all notifications");
  });

  it("builds clean plain text template", () => {
    const textWithActions = buildEmailText({
      title: "Invoice Paid",
      message: "Invoice INV-001 has been settled: $0.80.",
      actionLabel: "View Invoices",
      actionUrl: "https://app.payus.example/invoices",
      unsubscribeUrl: "https://app.payus.example/unsubscribe/abc123token",
    });

    expect(textWithActions).toBe(
      "PAYUS - Invoice Paid\n\nInvoice INV-001 has been settled: $0.80.\n\nView Invoices: https://app.payus.example/invoices\n\nUnsubscribe: https://app.payus.example/unsubscribe/abc123token",
    );

    const textSimple = buildEmailText({
      title: "Invoice Paid",
      message: "Invoice INV-001 has been settled: $0.80.",
    });

    expect(textSimple).toBe(
      "PAYUS - Invoice Paid\n\nInvoice INV-001 has been settled: $0.80.",
    );
  });

  it("returns not_configured without throwing when RESEND_API_KEY is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const result = await sendEmail({
      owner: "tess",
      to: "client@example.com",
      subject: "Test Subject",
      html: "<p>Hello</p>",
      text: "Hello",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_configured");
  });

  it("sends request to Resend API when configured", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg_123" }),
    });
    global.fetch = mockFetch;

    const result = await sendEmail({
      owner: "tess",
      to: "client@example.com",
      subject: "Test Subject",
      html: "<p>Hello</p>",
      text: "Hello",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toBe("msg_123");
    }
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test_key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          from: "Payus <test@payus.example>",
          to: "client@example.com",
          subject: "Test Subject",
          html: "<p>Hello</p>",
          text: "Hello",
        }),
      }),
    );
  });

  it("uses default EMAIL_FROM when EMAIL_FROM is empty or not set", async () => {
    vi.stubEnv("EMAIL_FROM", "");
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg_456" }),
    });
    global.fetch = mockFetch;

    const result = await sendEmail({
      owner: "tess",
      to: "client@example.com",
      subject: "Test Subject",
      html: "<p>Hello</p>",
      text: "Hello",
    });

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        body: JSON.stringify({
          from: "Payus <onboarding@resend.dev>",
          to: "client@example.com",
          subject: "Test Subject",
          html: "<p>Hello</p>",
          text: "Hello",
        }),
      }),
    );
  });

  it("handles non-ok HTTP responses gracefully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
    });
    global.fetch = mockFetch;

    const result = await sendEmail({
      owner: "tess",
      to: "invalid-email",
      subject: "Test Subject",
      html: "<p>Hello</p>",
      text: "Hello",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("request_failed");
  });

  it("handles timeout gracefully", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    const mockFetch = vi.fn().mockRejectedValue(abortError);
    global.fetch = mockFetch;

    const result = await sendEmail({
      owner: "tess",
      to: "client@example.com",
      subject: "Test Subject",
      html: "<p>Hello</p>",
      text: "Hello",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("timeout");
  });

  it("handles network error gracefully", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network failed"));
    global.fetch = mockFetch;

    const result = await sendEmail({
      owner: "tess",
      to: "client@example.com",
      subject: "Test Subject",
      html: "<p>Hello</p>",
      text: "Hello",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("request_failed");
  });
});

describe("a demo account may not send", () => {
  it("refuses before it reaches Resend", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await sendEmail({
      owner: "demo-a7f3k2zz",
      to: "someone@example.com",
      subject: "Hello",
      html: "<p>Hello</p>",
      text: "Hello",
    });
    expect(result).toEqual({ ok: false, reason: "demo" });
    // Not "it failed to send" — it never tried. The public demo is open to
    // anyone, and a send from it would be mail to any address from a domain
    // someone verified.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

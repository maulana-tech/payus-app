import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The only thing standing between the cron endpoints and the open web.
// `/api/cron/invoices` issues recurring invoices and sends reminders;
// `/api/cron/outbox` drains the queue that settles captures and expires
// proposals. Both are plain HTTP, so without this a stranger could run the
// business's scheduled work on demand.
//
// It had no test at all, which for an auth guard is the one place a
// coverage report is worth reading.

describe("cron authorisation", () => {
  let cronAuthorized: (request: Request) => boolean;
  const SECRET = "a-secret-of-some-length";

  beforeEach(async () => {
    process.env.CRON_SECRET = SECRET;
    // Re-imported per test so the env is read fresh.
    ({ cronAuthorized } = await import("../src/server/lib/cronAuth"));
  });

  afterEach(() => {
    process.env.CRON_SECRET = SECRET;
  });

  const ask = (authorization?: string) =>
    cronAuthorized(
      new Request("https://payus.test/api/cron/outbox", {
        headers: authorization ? { authorization } : {},
      }),
    );

  it("lets the scheduler through", () => {
    expect(ask(`Bearer ${SECRET}`)).toBe(true);
  });

  it("refuses a request with no authorisation at all", () => {
    expect(ask()).toBe(false);
  });

  it("refuses the wrong secret, and a right one of the wrong length", () => {
    expect(ask("Bearer not-the-secret-at-all")).toBe(false);
    // A prefix of the real secret: the length check is what stops this one
    // before the comparison, and `timingSafeEqual` throws on a mismatch.
    expect(ask(`Bearer ${SECRET.slice(0, 5)}`)).toBe(false);
    expect(ask(`Bearer ${SECRET}x`)).toBe(false);
  });

  it("refuses a scheme that is not Bearer, and the bare secret", () => {
    expect(ask(`Basic ${SECRET}`)).toBe(false);
    expect(ask(SECRET)).toBe(false);
    // Case matters: the header is compared as written.
    expect(ask(`bearer ${SECRET}`)).toBe(false);
  });

  it("refuses everything when no secret is configured", async () => {
    process.env.CRON_SECRET = "";
    // A deployment that forgot the secret must be closed, not open: an
    // empty expected value compared against an empty Bearer would
    // otherwise be a match.
    expect(ask(`Bearer ${SECRET}`)).toBe(false);
    expect(ask("Bearer ")).toBe(false);
  });
});

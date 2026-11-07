import { beforeEach, describe, expect, it, vi } from "vitest";

// The public demo runs in production, so what a demo account may do is
// fenced in code rather than by NODE_ENV. These are the fences.

const env = vi.hoisted(() => ({ demo: "", node: "development" as string }));

vi.mock("@/env.server", () => ({
  getServerEnv: () => ({ CRON_SECRET: "test-secret", DEMO_SECRET: "" }),
}));

vi.mock("@/env", () => ({
  env: {
    get NEXT_PUBLIC_PUBLIC_DEMO() {
      return env.demo;
    },
    get NODE_ENV() {
      return env.node;
    },
    NEXT_PUBLIC_DEMO_USER: undefined,
  },
}));

describe("who counts as a demo account", () => {
  beforeEach(() => {
    env.demo = "true";
    env.node = "production";
  });

  it("knows one by its prefix, which a username can never carry", async () => {
    const { isDemoOwner, isDemoName, newDemoName } = await import("@/lib/demo");
    const { usernameSchema } = await import(
      "@/server/modules/profiles/profiles.schema"
    );
    const name = newDemoName();

    expect(isDemoName(name)).toBe(true);
    expect(isDemoOwner(name)).toBe(true);
    expect(isDemoOwner("tess")).toBe(false);

    // The isolation is the hyphen: `usernameSchema` forbids it, so no demo
    // sandbox can ever collide with an account someone claimed.
    expect(usernameSchema.safeParse(name).success).toBe(false);
  });

  it("gives every visitor a different one", async () => {
    const { newDemoName } = await import("@/lib/demo");
    const names = new Set(Array.from({ length: 200 }, () => newDemoName()));
    expect(names.size).toBe(200);
  });

  it("stays off until it is turned on", async () => {
    env.demo = "";
    const { publicDemo } = await import("@/lib/demo");
    expect(publicDemo()).toBe(false);
  });
});

// The demo must not swallow the person who deployed it. The server is where
// that actually matters: it decides whose rows a request reaches.
describe("a real session wins over a demo cookie", () => {
  beforeEach(() => {
    env.demo = "true";
    env.node = "production";
  });

  it("ignores the demo cookie when a token is present", async () => {
    const { createTRPCContext } = await import("@/server/context");
    const { demoCookieValue } = await import("@/server/lib/demoCookie");
    const cookie = demoCookieValue("demo-a7f3k2zz");

    const withBoth = await createTRPCContext({
      req: new Request("http://payus.test/api/trpc/x", {
        headers: {
          cookie: `payus-demo=${encodeURIComponent(cookie)}`,
          authorization: "Bearer not-a-real-token",
        },
      }),
    });
    // Not a demo session: the token is what it must be judged on, even
    // though this one will not verify.
    expect(withBoth.demo).toBe(false);
    expect(withBoth.privyUserId).toBeNull();

    const cookieOnly = await createTRPCContext({
      req: new Request("http://payus.test/api/trpc/x", {
        headers: { cookie: `payus-demo=${encodeURIComponent(cookie)}` },
      }),
    });
    expect(cookieOnly.demo).toBe(true);
    expect(cookieOnly.privyUserId).toBe("demo:demo-a7f3k2zz");
  });
});

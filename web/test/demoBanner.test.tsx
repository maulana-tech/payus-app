// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The band that says the money is made up.
//
// It is a claim about *this visitor's* account, and it can be wrong in two
// directions. Missing, and a stranger reads a seeded ledger as their own.
// Present for a real owner, and we have told someone their money is
// pretend. The condition used to be `publicDemo()`, which says the
// deployment offers sandboxes and nothing about who is looking — so on a
// deployment with the demo switched on, every real owner was told their own
// takings were fictional.

const session = { username: null as string | null };
vi.mock("../src/components/SessionProvider", () => ({
  useSession: () => session,
}));

const env = { NEXT_PUBLIC_DEMO_USER: "", NODE_ENV: "production" };
vi.mock("@/env", () => ({ env }));

async function banner(username: string | null) {
  session.username = username;
  vi.resetModules();
  const { DemoBanner } = await import("../src/components/dashboard/DemoBanner");
  return render(<DemoBanner />);
}

// "Demo" appears twice — the label and the sentence around it — so the
// probe is the one phrase that appears once.
const shown = () => screen.queryByText(/made-up money/i);

describe("the demo band", () => {
  beforeEach(() => {
    env.NEXT_PUBLIC_DEMO_USER = "";
    env.NODE_ENV = "production";
  });

  it("warns a visitor who is in a sandbox, and names it", async () => {
    await banner("demo-4jnkgjb3");
    expect(shown()).not.toBeNull();
    expect(screen.getByText(/@demo-4jnkgjb3/)).toBeInTheDocument();
    expect(screen.getByText("Demo", { selector: "span" })).toBeInTheDocument();
  });

  it("says nothing to a real owner, even where sandboxes are offered", async () => {
    // This is the bug the condition was changed for: @lana is a real
    // account on the same deployment the public demo runs on.
    await banner("lana");
    expect(shown()).toBeNull();
  });

  it("warns on the single-demo deployment, where there is only one account", async () => {
    env.NEXT_PUBLIC_DEMO_USER = "demo";
    env.NODE_ENV = "development";
    await banner("demo");
    expect(shown()).not.toBeNull();
  });

  it("says nothing before a username is known", async () => {
    await banner(null);
    expect(shown()).toBeNull();
  });
});

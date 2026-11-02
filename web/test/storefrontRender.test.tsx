// @vitest-environment happy-dom
import { screen, waitFor } from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import { StorefrontPanel } from "../src/components/storefront/StorefrontPanel";
import { trpc } from "../src/trpc/react";
import { createTestQueryClient, renderWithTRPC } from "./renderWithTRPC";

// A storefront is configuration rendered by one renderer, so a field that
// looks like markup has to arrive on the page as text. This is the test
// behind that claim.

const shop = {
  id: "s1",
  owner: "shop",
  slug: "kopi",
  title: "Kopi Senja",
  blurb: "Beans roasted on Fridays",
  template: "shelf" as const,
  theme: "paper" as const,
  accent: "clay" as const,
  currency: "USD",
  state: "published" as const,
  writtenBy: "builder-agent",
  html: "<p>raw</p><script>alert(1)</script>",
  htmlClean: "<h2>How we roast</h2><p>Fridays.</p>",
  products: [
    {
      id: "p1",
      name: "<script>alert('x')</script>",
      description: "<img src=x onerror=alert(1)>",
      priceMinor: "450",
      minMinor: null,
      maxMinor: null,
      quantity: false,
      limit: 1,
      soldOut: false,
    },
    {
      id: "p2",
      name: "Tip",
      description: "Anything you like",
      priceMinor: null,
    },
  ],
  updatedAt: new Date().toISOString(),
};

function render(data: unknown) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(
    getQueryKey(trpc.storefront.public, { slug: "kopi" }, "query"),
    data,
  );
  return renderWithTRPC(<StorefrontPanel slug="kopi" />, { queryClient });
}

describe("storefront page", () => {
  it("shows a field that looks like markup as the text it is", async () => {
    const { container } = render(shop);
    await waitFor(() =>
      expect(screen.getByText("Kopi Senja")).toBeInTheDocument(),
    );

    // The name is on the page, verbatim, and nothing was parsed as HTML.
    expect(screen.getByText("<script>alert('x')</script>")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("prices what has a price and invites an amount for what does not", async () => {
    render(shop);
    await waitFor(() => expect(screen.getByText("$4.50")).toBeInTheDocument());
    expect(screen.getByText("You choose")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount")).toBeInTheDocument();
  });

  it("renders the sanitised copy, in a frame that cannot run anything", async () => {
    const { container } = render(shop);
    await waitFor(() =>
      expect(screen.getByText("Kopi Senja")).toBeInTheDocument(),
    );

    const frame = container.querySelector("iframe");
    expect(frame).not.toBeNull();
    // No allow-scripts: whatever is inside, nothing executes.
    expect(frame?.getAttribute("sandbox")).toBe("allow-same-origin");
    const doc = frame?.getAttribute("srcdoc") ?? "";
    expect(doc).toContain("How we roast");
    // The author's raw copy never reaches the page.
    expect(doc).not.toContain("<script>");
    expect(doc).not.toContain("<p>raw</p>");
  });

  it("says nothing is there when the shop is a draft", async () => {
    render(null);
    await waitFor(() =>
      expect(screen.getByText("Nothing here")).toBeInTheDocument(),
    );
    expect(screen.getByText(/not been published/)).toBeInTheDocument();
  });
});

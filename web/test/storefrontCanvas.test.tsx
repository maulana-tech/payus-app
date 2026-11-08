// @vitest-environment happy-dom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getQueryKey } from "@trpc/react-query";

// The canvas is the editor now, so what it has to get right is that the
// thing on the right is the page itself — the same renderer the public gets,
// fed the draft — and that the HTML block shown there came back from the
// server's sanitiser rather than from the editor's buffer.

vi.mock("../src/components/SessionProvider", () => ({
  useSession: () => ({ username: "shop" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// CodeMirror is a browser editor; the canvas loads it lazily and this test
// is about the canvas, not about it.
vi.mock("../src/components/canvas/HtmlEditor", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (next: string) => void;
  }) => (
    <textarea
      aria-label="HTML"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

import { CanvasEditor } from "../src/components/canvas/CanvasEditor";
import { storefrontInput } from "../src/features/storefront/config";
import { toInput } from "../src/features/storefront/draft";
import { starters } from "../src/features/storefront/starters";
import { trpc } from "../src/trpc/react";
import { createTestQueryClient, renderWithTRPC } from "./renderWithTRPC";

const RAW = "<h2>How we roast</h2><script>alert(1)</script>";
const CLEAN = "<h2>How we roast</h2>";

const shop = {
  id: "shop1234",
  owner: "shop",
  slug: "kopi-senja",
  title: "Kopi Senja",
  blurb: "Beans roasted on Fridays",
  template: "shelf" as const,
  theme: "paper" as const,
  accent: "clay" as const,
  html: RAW,
  htmlClean: CLEAN,
  currency: "USD",
  state: "draft" as const,
  writtenBy: "owner",
  products: [
    {
      id: "p1",
      name: "Flat white",
      description: "Made at the counter.",
      priceMinor: "450",
      minMinor: null,
      maxMinor: null,
      quantity: false,
      limit: 4,
      soldOut: false,
    },
  ],
  updatedAt: new Date().toISOString(),
};

function open() {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(
    getQueryKey(trpc.storefront.mine, undefined, "query"),
    [shop],
  );
  // `previewHtml` is a mutation — a query's input would ride in the URL,
  // and its input is a whole page — so it is answered over fetch rather
  // than seeded into the query cache. What the test asserts is unchanged:
  // the frame shows what came back, never the editor's buffer.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(
        typeof input === "string" || input instanceof URL
          ? input
          : (input as Request).url,
      );
      if (!url.includes("storefront.previewHtml"))
        throw new Error(`unexpected request: ${url}`);
      // Both readers of the sanitiser — the preview pane and the editor's
      // "taken out" line — are batched into one request, so the answer
      // needs one result per call or the second reader gets nothing.
      const calls = (url.split("?")[0]?.split("/").pop() ?? "").split(
        ",",
      ).length;
      return new Response(
        JSON.stringify(
          Array.from({ length: calls }, () => ({
            result: { data: { raw: RAW, clean: CLEAN, removed: ["script"] } },
          })),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );
  queryClient.setQueryData(
    getQueryKey(trpc.agents.status, undefined, "query"),
    { configured: false },
  );
  return renderWithTRPC(<CanvasEditor id={shop.id} />, { queryClient });
}

describe("storefront canvas", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the real page from the draft, with the pay button inert", async () => {
    open();

    // The page itself, not a sketch of it: the title, the item and the price
    // all come from the same renderer the public is served.
    await waitFor(() => screen.getByText("Flat white"));
    expect(screen.getByText("$4.50")).toBeTruthy();
    // The name is in the top bar as well, so pin this one to the page.
    expect(
      screen.getByRole("heading", { level: 1, name: "Kopi Senja" }),
    ).toBeTruthy();
    expect(screen.getByText("@shop")).toBeTruthy();
    // Nothing is payable in a draft, so there is a label and no button.
    expect(screen.getByText("Pay with PayPal").tagName).toBe("P");
  });

  it("shows the sanitised copy, never the buffer", async () => {
    const { container } = open();
    // The canvas opens on Blocks now; the "taken out" line lives beside
    // the raw markup, so this is the tab that shows it.
    await userEvent.click(screen.getByRole("button", { name: "HTML" }));

    await waitFor(() => {
      const frame = container.querySelector("iframe");
      expect(frame?.getAttribute("srcdoc")).toContain(CLEAN);
    });
    const srcdoc = container.querySelector("iframe")?.getAttribute("srcdoc");
    expect(srcdoc).not.toContain("<script>alert(1)</script>");
    // And the author is told what the policy took out. That line has its
    // own debounce and its own round trip, so it arrives after the frame.
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("<script>"),
    );
  });

  it("holds the page to a phone's width when asked", async () => {
    const { container } = open();
    await waitFor(() => screen.getByText("Flat white"));

    await userEvent.click(screen.getByLabelText("Phone"));
    await waitFor(() =>
      expect(
        container.querySelector<HTMLElement>('[style*="width: 414px"]'),
      ).toBeTruthy(),
    );
  });

  it("will not save until something changes", async () => {
    open();
    await waitFor(() => screen.getByText("Flat white"));

    const save = screen.getByRole("button", { name: "Save" });
    expect(save.hasAttribute("disabled")).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "HTML" }));
    await userEvent.type(screen.getByLabelText("HTML"), "<p>more</p>");
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
  });
});

/** A canvas with no shops, and the sanitiser's answer already in hand. */
function newShop() {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(
    getQueryKey(trpc.storefront.mine, undefined, "query"),
    [],
  );
  for (const starter of starters)
    queryClient.setQueryData(
      getQueryKey(
        trpc.storefront.previewHtml,
        { html: starter.draft.html },
        "query",
      ),
      { raw: starter.draft.html, clean: starter.draft.html, removed: [] },
    );
  return queryClient;
}

describe("starters", () => {
  // A starting point the schema refuses is a trap, not a shortcut: the owner
  // would meet the error on their first save and have nothing to fix it with.
  it.each(
    starters.map((starter) => [starter.name, starter] as const),
  )("%s is a draft the schema accepts", (_name, starter) => {
    const parsed = storefrontInput.safeParse(toInput(starter.draft));
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it("offers five of them, and a way past them", async () => {
    const queryClient = newShop();
    renderWithTRPC(<CanvasEditor id="new" />, { queryClient });

    expect(screen.getByText("Start from")).toBeTruthy();
    for (const starter of starters) expect(screen.getByText(starter.name));
    expect(starters).toHaveLength(5);

    // The canvas shows the starter being considered, through the same
    // renderer the public gets.
    await waitFor(() =>
      screen.getByRole("heading", {
        level: 1,
        name: starters[0].draft.title,
      }),
    );

    // Highlighting a second one moves the page with it.
    await userEvent.click(screen.getByText(starters[2].name));
    await waitFor(() =>
      screen.getByRole("heading", {
        level: 1,
        name: starters[2].draft.title,
      }),
    );

    // Taking it hands the draft to the editor, where it is ordinary.
    await userEvent.click(screen.getByRole("button", { name: "Use this one" }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Create as draft" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(
      starters[2].draft.title,
    );
  });

  it("can start from an empty page", async () => {
    const queryClient = newShop();
    renderWithTRPC(<CanvasEditor id="new" />, { queryClient });

    await userEvent.click(screen.getByText("Start from an empty page instead"));
    expect(screen.queryByText("Start from")).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("");
  });
});

// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbedBridge } from "../src/components/embed/EmbedBridge";
import { type EmbedEvent, postToParent } from "../src/features/embed/bridge";

// The widget's only way of speaking to the site that framed it. `embed.js`
// documents these four messages and resizes the iframe on one of them, so a
// page that stops sending them is a widget stuck at its default height with
// no way to tell the merchant a payment landed — which is how it sat for a
// while, with nothing failing.
//
// `window.parent === window` outside a frame, so every test here has to
// pretend to be framed before any of this does anything at all. That guard
// is itself worth a test: posting to yourself would be a message the page
// handles as if a parent had sent it.

type Sent = { data: EmbedEvent; origin: string };

function framed(): { sent: Sent[]; restore: () => void } {
  const sent: Sent[] = [];
  const parent = {
    postMessage: (data: EmbedEvent, origin: string) => {
      sent.push({ data, origin });
    },
  };
  const original = Object.getOwnPropertyDescriptor(window, "parent");
  Object.defineProperty(window, "parent", {
    value: parent,
    configurable: true,
  });
  return {
    sent,
    restore: () => {
      if (original) Object.defineProperty(window, "parent", original);
    },
  };
}

/** Every element a ResizeObserver was pointed at, this test file's stub. */
const watched: Element[] = [];

describe("embed bridge", () => {
  let frame: ReturnType<typeof framed>;

  beforeEach(() => {
    // happy-dom has no ResizeObserver, and the hook's whole job depends on
    // one. A stub that records its target is enough to prove it observes.
    watched.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(element: Element) {
          watched.push(element);
        }
        disconnect() {}
      },
    );
    frame = framed();
  });

  afterEach(() => {
    frame.restore();
    vi.unstubAllGlobals();
  });

  it("says nothing when the page is not in a frame", () => {
    frame.restore(); // back to window.parent === window
    const sent: unknown[] = [];
    const spy = vi
      .spyOn(window, "postMessage")
      .mockImplementation((data) => sent.push(data));
    postToParent({ type: "payus:ready" });
    expect(sent).toEqual([]);
    spy.mockRestore();
  });

  it("announces itself and sends a height as soon as it mounts", () => {
    render(<EmbedBridge />);
    const types = frame.sent.map((message) => message.data.type);
    expect(types[0]).toBe("payus:ready");
    expect(types).toContain("payus:resize");

    const resize = frame.sent.find(
      (message) => message.data.type === "payus:resize",
    );
    // A number, whatever happy-dom measures it as: the contract with
    // embed.js is the shape, and it clamps the value itself.
    expect(
      resize?.data.type === "payus:resize" && resize.data.height,
    ).toBeTypeOf("number");
  });

  it("measures the widget's own root, not the document", () => {
    // This is the difference between a widget that fits and one that only
    // ever grows: the document is at least as tall as the iframe, so a
    // height measured from it can never come back down.
    const root = document.createElement("div");
    root.id = "payus-embed-root";
    document.body.append(root);

    render(<EmbedBridge />);
    expect(watched).toEqual([root]);
    root.remove();
  });

  it("falls back to the document when there is no root to measure", () => {
    render(<EmbedBridge />);
    expect(watched).toEqual([document.documentElement]);
  });

  it("carries status and never a figure or an address", () => {
    const events: EmbedEvent[] = [
      { type: "payus:ready" },
      { type: "payus:resize", height: 418 },
      { type: "payus:payer-says-paid" },
      { type: "payus:paid", invoice: "INV-001" },
    ];
    for (const event of events) postToParent(event);

    const body = JSON.stringify(frame.sent.map((message) => message.data));
    // An invoice number is a reference the merchant already has. What must
    // never ride along is money or a person.
    expect(body).not.toMatch(/amount|minor|currency|email|@/i);
    expect(frame.sent.map((message) => message.data.type)).toEqual([
      "payus:ready",
      "payus:resize",
      "payus:payer-says-paid",
      "payus:paid",
    ]);
  });

  it("posts to any origin, because the parent is the one that checks", () => {
    postToParent({ type: "payus:ready" });
    // embed.js verifies the message came from Payus; this side cannot know
    // the embedding origin, and narrowing it here would only break the
    // widget on every site that is not the one guessed.
    expect(frame.sent.at(-1)?.origin).toBe("*");
  });
});

import { describe, expect, it } from "vitest";
import { messagingPubkeyHex, open, seal } from "../src/lib/sealedBox";

const alice = new Uint8Array(32).fill(1);
const bob = new Uint8Array(32).fill(2);

describe("sealed boxes", () => {
  it("opens only with the recipient's secret", () => {
    const box = seal(
      { amountMinor: "2500", note: "dinner" },
      messagingPubkeyHex(alice),
    );
    expect(open(box, alice)).toEqual({ amountMinor: "2500", note: "dinner" });
    expect(() => open(box, bob)).toThrow();
  });
  it("detects tampering", () => {
    const box = seal({ n: 1 }, messagingPubkeyHex(alice));
    const flipped = {
      ...box,
      ct: (box.ct[0] === "0" ? "1" : "0") + box.ct.slice(1),
    };
    expect(() => open(flipped, alice)).toThrow();
  });
});

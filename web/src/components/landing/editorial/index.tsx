"use client";

import { ReactLenis } from "lenis/react";
import { Council } from "./council";
import { Frame } from "./frame";
import {
  Brought,
  Chapter,
  Closing,
  Hero,
  Questions,
  Settles,
  Terms,
  Ways,
} from "./sections";

/**
 * The landing: a fixed hairline frame over full-bleed painted loops, with
 * oversized light serif and mono micro-labels. Smooth scrolling is on,
 * because the pinned table reads as one camera move.
 */
export function EditorialLanding() {
  return (
    <ReactLenis root>
      <div className="relative bg-ed-dark-2 font-(family-name:--font-landing) text-ed-cream antialiased">
        <Frame />
        <main id="main-content">
          <Hero />
          <Chapter
            id="rail"
            film="arrive"
            tag="Orders v2"
            title={"It arrives,\nand it arrives once."}
            body="The payer approves an order and PayPal confirms it twice — once to the browser, once by webhook. Both land in the same place, and the second one changes nothing. The amounts are never taken from the message: they are read back from PayPal before a single entry is written."
          />
          <Chapter
            id="agents"
            film="together"
            tag="Guardian"
            title={"Proposed by a model.\nDecided by a rule."}
            body="An agent writes down what it wants: who is paid, how much, out of which pot. A deterministic engine accepts or refuses it against limits you set, and an approval is bound to the hash of what was approved. Change one digit afterwards and the approval dies with it."
          />
          <Council />
          <Ways />
          {/* What a payment writes, then what happens to it, then what you
              can bring to it — the rail first and the reasoning after, so
              the claims arrive in the order they depend on each other. */}
          <Settles />
          <Brought />
          <Terms />
          <Questions />
        </main>
        <Closing />
      </div>
    </ReactLenis>
  );
}

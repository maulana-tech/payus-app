// Somewhere to start. A blank canvas is the worst page in the editor, so a
// new shop opens on five shops that already work — each one a complete
// draft, not a theme: a layout, a palette, items priced the way that kind of
// shop prices things, and a block of prose where it earns its place.
//
// These are values in the same shape the schema takes. Nothing here is
// special-cased downstream: picking one fills the editor, and from that
// moment it is an ordinary draft.

import type { Draft, Line } from "./draft";
import { emptyLine, slugify } from "./draft";

export type Starter = {
  id: string;
  /** What this kind of shop is called, in the owner's words. */
  name: string;
  /** One line on who it is for. */
  hint: string;
  draft: Draft;
};

const line = (values: Partial<Line>): Line => ({ ...emptyLine, ...values });

const STARTERS: Starter[] = [
  {
    id: "coffee",
    name: "Coffee bar",
    hint: "A few things over the counter, and beans to take home.",
    draft: {
      slug: "",
      title: "Kopi Senja",
      blurb: "Single-origin beans, roasted on Fridays in Bandung.",
      template: "shelf",
      theme: "sun",
      accent: "ochre",
      html: [
        "<h2>How we roast</h2>",
        "<p>Small batches on a 1kg drum, Friday mornings, so a bag you order",
        "on Saturday was green coffee the day before.</p>",
        '<div class="shop-cols">',
        "  <div><h3>This week</h3><p>Washed Gayo, Aceh — cocoa and orange peel.</p></div>",
        "  <div><h3>Next week</h3><p>Natural Kintamani, Bali — strawberry, dense.</p></div>",
        "</div>",
      ].join("\n"),
      lines: [
        line({
          name: "Bag of beans, 250g",
          description: "This week: Gayo, washed.",
          price: "18.00",
          quantity: true,
          limit: "6",
        }),
        line({
          name: "Flat white",
          description: "Made at the counter.",
          price: "4.50",
          quantity: true,
          limit: "4",
        }),
        line({
          name: "Saturday cupping",
          description: "Taste the week's lots side by side. Two seats.",
          price: "12.00",
        }),
        line({
          name: "Tip the roaster",
          description: "Only if you want to.",
          price: "",
          min: "2.00",
          max: "200.00",
        }),
      ],
    },
  },
  {
    id: "services",
    name: "Freelance work",
    hint: "A couple of packages, priced plainly, with what is included.",
    draft: {
      slug: "",
      title: "Studio Lana",
      blurb: "Interface design and front-end, booked by the week.",
      template: "single",
      theme: "paper",
      accent: "indigo",
      html: [
        '<p class="shop-lead">Two ways to work together. Both start with a call,',
        "and neither needs a contract longer than a page.</p>",
        '<div class="shop-card">',
        "  <h3>What a week looks like</h3>",
        "  <ul>",
        "    <li>Monday: what we are solving, and what we are not.</li>",
        "    <li>Tuesday to Thursday: the work, in the open.</li>",
        "    <li>Friday: handover, and what I would do next.</li>",
        "  </ul>",
        "</div>",
        '<p class="shop-muted">Invoices are paid here. Nothing starts before one is.</p>',
      ].join("\n"),
      lines: [
        line({
          name: "A design sprint",
          description: "One week, one problem, a clickable answer at the end.",
          price: "2400.00",
        }),
        line({
          name: "A day of consulting",
          description: "Your team, my eyes, and notes you can act on.",
          price: "600.00",
        }),
      ],
    },
  },
  {
    id: "tip",
    name: "Tip jar",
    hint: "One thing to support, and the payer names the amount.",
    draft: {
      slug: "",
      title: "Buy me a coffee",
      blurb: "I write about payments, slowly and for free.",
      template: "tip",
      theme: "ink",
      accent: "clay",
      html: [
        '<p class="shop-lead">If something here saved you an afternoon, this is',
        "where you can say so.</p>",
        "<p>Everything I publish stays free to read. Tips pay for the hosting,",
        "the coffee, and the hours that go into the long posts.</p>",
        '<p class="shop-muted">No subscription, no tiers, nothing locked.</p>',
      ].join("\n"),
      lines: [
        line({
          name: "A coffee",
          description: "Whatever it is worth to you.",
          price: "",
          min: "2.00",
          max: "500.00",
        }),
      ],
    },
  },
  {
    id: "menu",
    name: "Warung menu",
    hint: "A compact list people order from, priced per plate.",
    draft: {
      slug: "",
      title: "Warung Ibu Sri",
      blurb: "Home cooking, Jalan Riau, from eleven until it runs out.",
      template: "menu",
      theme: "paper",
      accent: "olive",
      html: [
        '<div class="shop-card">',
        "  <h3>Open</h3>",
        "  <table>",
        "    <tr><td>Tuesday to Friday</td><td>11.00 — 20.00</td></tr>",
        "    <tr><td>Saturday</td><td>11.00 — 15.00</td></tr>",
        "    <tr><td>Sunday and Monday</td><td>Closed</td></tr>",
        "  </table>",
        "</div>",
        '<p class="shop-muted">Order here, collect at the counter. Rice is included.</p>',
      ].join("\n"),
      lines: [
        line({
          name: "Nasi campur",
          description: "Rice, two sides, egg, sambal.",
          price: "3.50",
          quantity: true,
          limit: "10",
        }),
        line({
          name: "Ayam bakar",
          description: "Grilled over coals, half a bird.",
          price: "5.00",
          quantity: true,
          limit: "6",
        }),
        line({
          name: "Sayur asem",
          description: "Tamarind soup, as sour as it should be.",
          price: "2.00",
          quantity: true,
          limit: "10",
        }),
        line({
          name: "Es teh manis",
          description: "Sweet iced tea.",
          price: "1.00",
          quantity: true,
          limit: "12",
        }),
        line({
          name: "Tempe mendoan",
          description: "Fried soft, five pieces.",
          price: "1.50",
          quantity: true,
          limit: "10",
        }),
      ],
    },
  },
  {
    id: "event",
    name: "Class or event",
    hint: "Seats for one date, with the practicalities on the page.",
    draft: {
      slug: "",
      title: "Brewing, from the start",
      blurb: "A two-hour class for people who own a kettle and no idea.",
      template: "single",
      theme: "sun",
      accent: "sea",
      html: [
        '<div class="shop-cols">',
        "  <div>",
        "    <h3>When</h3>",
        "    <p>Saturday 22 November, 10.00 — 12.00.</p>",
        "  </div>",
        "  <div>",
        "    <h3>Where</h3>",
        "    <p>Jalan Braga 18, Bandung. Upstairs, past the roaster.</p>",
        "  </div>",
        "</div>",
        "<h2>What you will do</h2>",
        "<ul>",
        "  <li>Grind, weigh and taste the same coffee four ways.</li>",
        "  <li>Learn one recipe you can repeat at home on Monday.</li>",
        "  <li>Take 100g of beans with you.</li>",
        "</ul>",
        '<p class="shop-muted">Twelve seats. Cancel up to a week before for a full refund.</p>',
      ].join("\n"),
      lines: [
        line({
          name: "A seat",
          description: "Includes beans to take home.",
          price: "25.00",
          quantity: true,
          limit: "4",
        }),
      ],
    },
  },
];

/** Each starter with its address filled in from its name. */
export const starters: Starter[] = STARTERS.map((starter) => ({
  ...starter,
  draft: { ...starter.draft, slug: slugify(starter.draft.title) },
}));

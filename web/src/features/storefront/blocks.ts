import { newId } from "@/lib/ids";

// The shop page as a list of blocks, so it can be edited without anyone
// typing a tag — and still be stored as the one HTML field everything else
// already understands.
//
// The rule that makes this safe: **the HTML is the truth, and the blocks
// are a reading of it.** There is no second column to drift, no migration,
// and a page written by hand in the HTML tab is not lost the moment someone
// opens the block editor. Anything this file cannot recognise comes back as
// a single `html` block, kept verbatim and rendered as it was.
//
// `toBlocks(toHtml(b))` must equal `b` for every block this file emits.
// That round trip is what lets the two editors sit on one field, and
// `test/storefrontBlocks.test.ts` is where it is held.

export type Block =
  | { id: string; kind: "heading"; level: 2 | 3; text: string }
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "lead"; text: string }
  | { id: string; kind: "quiet"; text: string }
  | { id: string; kind: "list"; ordered: boolean; items: string[] }
  | { id: string; kind: "quote"; text: string }
  | { id: string; kind: "card"; title: string; text: string }
  | {
      id: string;
      kind: "columns";
      left: { title: string; text: string };
      right: { title: string; text: string };
    }
  | { id: string; kind: "image"; src: string; alt: string; caption: string }
  | { id: string; kind: "link"; href: string; text: string }
  /** A link that looks like an action: another of your pages, or a link to pay. */
  | { id: string; kind: "cta"; href: string; text: string }
  /** Two or three of those side by side. */
  | { id: string; kind: "buttons"; items: { href: string; text: string }[] }
  /** Questions that open, which is the one interactive thing a frame with
      no scripts can still do: `<details>` is the browser's own. */
  | { id: string; kind: "faq"; items: { q: string; a: string }[] }
  | { id: string; kind: "steps"; items: { title: string; text: string }[] }
  | { id: string; kind: "stats"; items: { figure: string; label: string }[] }
  | { id: string; kind: "gallery"; items: { src: string; alt: string }[] }
  | { id: string; kind: "table"; head: string[]; rows: string[][] }
  | { id: string; kind: "note"; text: string }
  | { id: string; kind: "spacer"; size: "sm" | "md" | "lg" }
  | { id: string; kind: "divider" }
  /** Anything written by hand that the reader did not recognise. */
  | { id: string; kind: "html"; html: string };

export type BlockKind = Block["kind"];

/** The four shelves the "add" menu is arranged on. */
export type BlockGroup = "Writing" | "Showing" | "Doing" | "Spacing";

/**
 * What the "add" menu offers.
 *
 * Grouped, because twenty things in one column is a list you read rather
 * than a menu you choose from, and `words` so the menu can be searched by
 * what someone would call the thing rather than by what we called it.
 */
export const BLOCK_KINDS: {
  kind: BlockKind;
  label: string;
  hint: string;
  group: BlockGroup;
  words?: string;
}[] = [
  // Writing
  {
    kind: "heading",
    label: "Heading",
    hint: "A section heading",
    group: "Writing",
    words: "title h2 h3",
  },
  {
    kind: "text",
    label: "Text",
    hint: "A paragraph",
    group: "Writing",
    words: "paragraph prose body",
  },
  {
    kind: "lead",
    label: "Lead",
    hint: "A larger opening line",
    group: "Writing",
    words: "intro subtitle",
  },
  {
    kind: "quiet",
    label: "Quiet",
    hint: "A smaller, softer line",
    group: "Writing",
    words: "caption small note",
  },
  {
    kind: "list",
    label: "List",
    hint: "Bulleted or numbered",
    group: "Writing",
    words: "bullets points",
  },
  {
    kind: "quote",
    label: "Quote",
    hint: "A pulled quote",
    group: "Writing",
    words: "testimonial review",
  },
  {
    kind: "note",
    label: "Note",
    hint: "One line, set apart",
    group: "Writing",
    words: "callout banner notice",
  },
  // Showing
  {
    kind: "card",
    label: "Card",
    hint: "A panel in the shop's colours",
    group: "Showing",
    words: "panel box",
  },
  {
    kind: "columns",
    label: "Two columns",
    hint: "Side by side on a wide screen",
    group: "Showing",
    words: "grid two",
  },
  {
    kind: "image",
    label: "Image",
    hint: "By https address",
    group: "Showing",
    words: "photo picture",
  },
  {
    kind: "gallery",
    label: "Gallery",
    hint: "A few images in a row",
    group: "Showing",
    words: "photos pictures grid",
  },
  {
    kind: "stats",
    label: "Figures",
    hint: "Numbers with what they mean",
    group: "Showing",
    words: "stats numbers metrics",
  },
  {
    kind: "steps",
    label: "Steps",
    hint: "How it works, in order",
    group: "Showing",
    words: "how it works process numbered",
  },
  {
    kind: "table",
    label: "Table",
    hint: "Rows and columns",
    group: "Showing",
    words: "prices specs grid",
  },
  {
    kind: "faq",
    label: "Questions",
    hint: "Answers that open when tapped",
    group: "Showing",
    words: "faq accordion details",
  },
  // Doing
  {
    kind: "link",
    label: "Link",
    hint: "Opens in a new tab",
    group: "Doing",
    words: "url anchor",
  },
  {
    kind: "cta",
    label: "Pay link",
    hint: "A button to one of your pay links",
    group: "Doing",
    words: "button checkout buy pay",
  },
  {
    kind: "buttons",
    label: "Buttons",
    hint: "Two or three side by side",
    group: "Doing",
    words: "row of buttons actions",
  },
  // Spacing
  {
    kind: "divider",
    label: "Divider",
    hint: "A rule between sections",
    group: "Spacing",
    words: "rule line hr separator",
  },
  {
    kind: "spacer",
    label: "Space",
    hint: "Room, and nothing in it",
    group: "Spacing",
    words: "gap padding blank",
  },
];

/** The groups, in the order the menu shows them. */
export const BLOCK_GROUPS: BlockGroup[] = [
  "Writing",
  "Showing",
  "Doing",
  "Spacing",
];

/** A new block of a kind, with something in it rather than nothing. */
export function blankBlock(kind: BlockKind): Block {
  const id = newId(10);
  switch (kind) {
    case "heading":
      return { id, kind, level: 2, text: "A heading" };
    case "text":
      return { id, kind, text: "Something about the shop." };
    case "lead":
      return { id, kind, text: "The line people read first." };
    case "quiet":
      return { id, kind, text: "A smaller note." };
    case "list":
      return { id, kind, ordered: false, items: ["One", "Two"] };
    case "quote":
      return { id, kind, text: "What someone said about it." };
    case "card":
      return {
        id,
        kind,
        title: "Opening hours",
        text: "Tuesday to Sunday, 8am until the beans run out.",
      };
    case "columns":
      return {
        id,
        kind,
        left: { title: "This", text: "And what it is." },
        right: { title: "That", text: "And what it is." },
      };
    case "image":
      return {
        id,
        kind,
        src: "https://example.com/photo.jpg",
        alt: "",
        caption: "",
      };
    case "link":
      return { id, kind, href: "https://example.com", text: "Somewhere else" };
    case "cta":
      return { id, kind, href: "https://example.com/pay", text: "Pay here" };
    case "buttons":
      return {
        id,
        kind,
        items: [
          { href: "https://example.com/pay", text: "Buy now" },
          { href: "https://example.com", text: "Read more" },
        ],
      };
    case "faq":
      return {
        id,
        kind,
        items: [
          {
            q: "When does it ship?",
            a: "Within two working days of the payment landing.",
          },
          {
            q: "Can I collect it instead?",
            a: "Yes — ask and we will keep it.",
          },
        ],
      };
    case "steps":
      return {
        id,
        kind,
        items: [
          { title: "Choose", text: "Pick what you want from the list." },
          { title: "Pay", text: "Through PayPal, on the same page." },
          { title: "Collect", text: "We send a receipt the moment it clears." },
        ],
      };
    case "stats":
      return {
        id,
        kind,
        items: [
          { figure: "2016", label: "Roasting since" },
          { figure: "18", label: "Farms we buy from" },
          { figure: "48h", label: "Bean to doorstep" },
        ],
      };
    case "gallery":
      return {
        id,
        kind,
        items: [
          { src: "https://example.com/one.jpg", alt: "" },
          { src: "https://example.com/two.jpg", alt: "" },
        ],
      };
    case "table":
      return {
        id,
        kind,
        head: ["What", "How much"],
        rows: [
          ["Single origin, 250g", "Rp 120.000"],
          ["House blend, 1kg", "Rp 380.000"],
        ],
      };
    case "note":
      return {
        id,
        kind,
        text: "Orders placed after 4pm go out the next morning.",
      };
    case "spacer":
      return { id, kind, size: "md" };
    case "divider":
      return { id, kind };
    default:
      return { id, kind: "text", text: "" };
  }
}

// ---------------------------------------------------------------- writing

export const esc = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function one(block: Block): string {
  switch (block.kind) {
    case "heading":
      return `<h${block.level}>${esc(block.text)}</h${block.level}>`;
    case "text":
      return `<p>${esc(block.text)}</p>`;
    case "lead":
      return `<p class="shop-lead">${esc(block.text)}</p>`;
    case "quiet":
      return `<p class="shop-muted">${esc(block.text)}</p>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items
        .map((item) => `  <li>${esc(item)}</li>`)
        .join("\n");
      return `<${tag}>\n${items}\n</${tag}>`;
    }
    case "quote":
      return `<blockquote>${esc(block.text)}</blockquote>`;
    case "card":
      return `<div class="shop-card">\n  <h3>${esc(
        block.title,
      )}</h3>\n  <p>${esc(block.text)}</p>\n</div>`;
    case "columns":
      return `<div class="shop-cols">\n  <div>\n    <h3>${esc(
        block.left.title,
      )}</h3>\n    <p>${esc(
        block.left.text,
      )}</p>\n  </div>\n  <div>\n    <h3>${esc(
        block.right.title,
      )}</h3>\n    <p>${esc(block.right.text)}</p>\n  </div>\n</div>`;
    case "image": {
      const img = `<img src="${esc(block.src)}" alt="${esc(block.alt)}">`;
      return block.caption
        ? `<figure>\n  ${img}\n  <figcaption>${esc(
            block.caption,
          )}</figcaption>\n</figure>`
        : `<figure>\n  ${img}\n</figure>`;
    }
    case "link":
      return `<p><a href="${esc(block.href)}">${esc(block.text)}</a></p>`;
    case "cta":
      return `<p><a class="shop-cta" href="${esc(block.href)}">${esc(
        block.text,
      )}</a></p>`;
    case "buttons":
      return `<div class="shop-row">\n${block.items
        .map(
          (item) =>
            `  <a class="shop-cta" href="${esc(item.href)}">${esc(
              item.text,
            )}</a>`,
        )
        .join("\n")}\n</div>`;
    case "faq":
      return `<div class="shop-faq">\n${block.items
        .map(
          (item) =>
            `  <details>\n    <summary>${esc(
              item.q,
            )}</summary>\n    <p>${esc(item.a)}</p>\n  </details>`,
        )
        .join("\n")}\n</div>`;
    case "steps":
      return `<ol class="shop-steps">\n${block.items
        .map(
          (item) =>
            `  <li>\n    <h3>${esc(item.title)}</h3>\n    <p>${esc(
              item.text,
            )}</p>\n  </li>`,
        )
        .join("\n")}\n</ol>`;
    case "stats":
      return `<div class="shop-stats">\n${block.items
        .map(
          (item) =>
            `  <div>\n    <strong>${esc(
              item.figure,
            )}</strong>\n    <span>${esc(item.label)}</span>\n  </div>`,
        )
        .join("\n")}\n</div>`;
    case "gallery":
      return `<div class="shop-gallery">\n${block.items
        .map((item) => `  <img src="${esc(item.src)}" alt="${esc(item.alt)}">`)
        .join("\n")}\n</div>`;
    case "table": {
      const cells = (row: string[], tag: "th" | "td") =>
        row.map((cell) => `<${tag}>${esc(cell)}</${tag}>`).join("");
      const body = block.rows
        .map((row) => `    <tr>${cells(row, "td")}</tr>`)
        .join("\n");
      return `<table>\n  <thead>\n    <tr>${cells(
        block.head,
        "th",
      )}</tr>\n  </thead>\n  <tbody>\n${body}\n  </tbody>\n</table>`;
    }
    case "note":
      return `<p class="shop-note">${esc(block.text)}</p>`;
    case "spacer":
      return `<div class="shop-space shop-space-${block.size}"></div>`;
    case "divider":
      return "<hr>";
    case "html":
      return block.html;
  }
}

/** The page, as the HTML field stores it. */
export function toHtml(blocks: Block[]): string {
  return blocks.map(one).join("\n");
}

// ---------------------------------------------------------------- reading

const text = (el: Element | null | undefined): string =>
  (el?.textContent ?? "").trim();

/** The two `<div>`s of a two-column block, if that is what this is. */
function asColumns(el: Element): Block | null {
  if (!el.classList.contains("shop-cols")) return null;
  const sides = [...el.children].filter((c) => c.tagName === "DIV");
  if (sides.length !== 2) return null;
  const side = (at: number) => ({
    title: text(sides[at]?.querySelector("h3")),
    text: text(sides[at]?.querySelector("p")),
  });
  // Only a pair of exactly <h3><p> reads as columns; anything richer keeps
  // its markup rather than being flattened into four strings.
  const plain = sides.every(
    (s) =>
      s.children.length === 2 &&
      s.children[0]?.tagName === "H3" &&
      s.children[1]?.tagName === "P",
  );
  if (!plain) return null;
  return { id: newId(10), kind: "columns", left: side(0), right: side(1) };
}

function asCard(el: Element): Block | null {
  if (!el.classList.contains("shop-card")) return null;
  if (
    el.children.length !== 2 ||
    el.children[0]?.tagName !== "H3" ||
    el.children[1]?.tagName !== "P"
  )
    return null;
  return {
    id: newId(10),
    kind: "card",
    title: text(el.children[0]),
    text: text(el.children[1]),
  };
}

/** True when an element carries nothing but its own text. */
const plainText = (el: Element) => el.children.length === 0;

/** Children that are exactly these tags, in this order, each plain text. */
const shaped = (el: Element, tags: string[]) =>
  el.children.length === tags.length &&
  tags.every(
    (tag, at) =>
      el.children[at]?.tagName === tag && plainText(el.children[at] as Element),
  );

/** A `<div class="shop-row">` of nothing but action links. */
function asButtons(el: Element): Block | null {
  if (!el.classList.contains("shop-row")) return null;
  const kids = [...el.children];
  if (
    kids.length === 0 ||
    !kids.every(
      (a) =>
        a.tagName === "A" && a.classList.contains("shop-cta") && plainText(a),
    )
  )
    return null;
  return {
    id: newId(10),
    kind: "buttons",
    items: kids.map((a) => ({
      href: a.getAttribute("href") ?? "",
      text: text(a),
    })),
  };
}

function asFaq(el: Element): Block | null {
  if (!el.classList.contains("shop-faq")) return null;
  const kids = [...el.children];
  if (
    kids.length === 0 ||
    !kids.every((d) => d.tagName === "DETAILS" && shaped(d, ["SUMMARY", "P"]))
  )
    return null;
  return {
    id: newId(10),
    kind: "faq",
    items: kids.map((d) => ({
      q: text(d.children[0]),
      a: text(d.children[1]),
    })),
  };
}

function asSteps(el: Element): Block | null {
  if (!el.classList.contains("shop-steps")) return null;
  const kids = [...el.children];
  if (
    kids.length === 0 ||
    !kids.every((li) => li.tagName === "LI" && shaped(li, ["H3", "P"]))
  )
    return null;
  return {
    id: newId(10),
    kind: "steps",
    items: kids.map((li) => ({
      title: text(li.children[0]),
      text: text(li.children[1]),
    })),
  };
}

function asStats(el: Element): Block | null {
  if (!el.classList.contains("shop-stats")) return null;
  const kids = [...el.children];
  if (
    kids.length === 0 ||
    !kids.every((d) => d.tagName === "DIV" && shaped(d, ["STRONG", "SPAN"]))
  )
    return null;
  return {
    id: newId(10),
    kind: "stats",
    items: kids.map((d) => ({
      figure: text(d.children[0]),
      label: text(d.children[1]),
    })),
  };
}

function asGallery(el: Element): Block | null {
  if (!el.classList.contains("shop-gallery")) return null;
  const kids = [...el.children];
  if (kids.length === 0 || !kids.every((img) => img.tagName === "IMG"))
    return null;
  return {
    id: newId(10),
    kind: "gallery",
    items: kids.map((img) => ({
      src: img.getAttribute("src") ?? "",
      alt: img.getAttribute("alt") ?? "",
    })),
  };
}

/** `<div class="shop-space shop-space-md">`, and nothing inside it. */
function asSpacer(el: Element): Block | null {
  if (!el.classList.contains("shop-space")) return null;
  if (el.childNodes.length > 0) return null;
  const size = (["sm", "md", "lg"] as const).find((one) =>
    el.classList.contains(`shop-space-${one}`),
  );
  if (!size || el.classList.length !== 2) return null;
  return { id: newId(10), kind: "spacer", size };
}

/** A head row and body rows, all of them plain cells. */
function asTable(el: Element): Block | null {
  const kids = [...el.children];
  const head = kids.find((k) => k.tagName === "THEAD");
  const body = kids.find((k) => k.tagName === "TBODY");
  if (!head || !body || kids.length !== 2) return null;
  const rowOf = (tr: Element, tag: "TH" | "TD") =>
    [...tr.children].every((c) => c.tagName === tag && plainText(c))
      ? [...tr.children].map((c) => text(c))
      : null;
  if (head.children.length !== 1) return null;
  const headRow = rowOf(head.children[0] as Element, "TH");
  if (!headRow) return null;
  const rows: string[][] = [];
  for (const tr of [...body.children]) {
    if (tr.tagName !== "TR") return null;
    const row = rowOf(tr, "TD");
    if (!row) return null;
    rows.push(row);
  }
  return { id: newId(10), kind: "table", head: headRow, rows };
}

function read(el: Element): Block {
  const id = newId(10);
  const kept = (): Block => ({ id, kind: "html", html: el.outerHTML });

  switch (el.tagName) {
    case "H2":
    case "H3":
      return plainText(el)
        ? {
            id,
            kind: "heading",
            level: el.tagName === "H2" ? 2 : 3,
            text: text(el),
          }
        : kept();
    case "HR":
      return { id, kind: "divider" };
    case "BLOCKQUOTE":
      return plainText(el) ? { id, kind: "quote", text: text(el) } : kept();
    case "P": {
      // A paragraph holding only a link is the link block.
      const only = el.children.length === 1 ? el.children[0] : null;
      if (only?.tagName === "A" && plainText(only) && el.classList.length === 0)
        return {
          id,
          // The class is the whole difference between a line of prose with
          // a link in it and a button.
          kind: only.classList.contains("shop-cta") ? "cta" : "link",
          href: only.getAttribute("href") ?? "",
          text: text(only),
        };
      if (!plainText(el)) return kept();
      if (el.classList.contains("shop-lead"))
        return { id, kind: "lead", text: text(el) };
      if (el.classList.contains("shop-muted"))
        return { id, kind: "quiet", text: text(el) };
      if (el.classList.contains("shop-note"))
        return { id, kind: "note", text: text(el) };
      // A class we do not write is a class we must not drop.
      if (el.classList.length > 0) return kept();
      return { id, kind: "text", text: text(el) };
    }
    case "UL":
    case "OL": {
      const steps = asSteps(el);
      if (steps) return steps;
      if (el.classList.length > 0) return kept();
      const items = [...el.children];
      if (!items.every((li) => li.tagName === "LI" && plainText(li)))
        return kept();
      return {
        id,
        kind: "list",
        ordered: el.tagName === "OL",
        items: items.map((li) => text(li)),
      };
    }
    case "FIGURE": {
      const img = el.querySelector("img");
      const caption = el.querySelector("figcaption");
      const expected = caption ? 2 : 1;
      if (!img || el.children.length !== expected) return kept();
      return {
        id,
        kind: "image",
        src: img.getAttribute("src") ?? "",
        alt: img.getAttribute("alt") ?? "",
        caption: text(caption),
      };
    }
    case "TABLE":
      return asTable(el) ?? kept();
    case "DIV":
      return (
        asCard(el) ??
        asColumns(el) ??
        asButtons(el) ??
        asFaq(el) ??
        asStats(el) ??
        asGallery(el) ??
        asSpacer(el) ??
        kept()
      );
    default:
      return kept();
  }
}

/**
 * Turns a string of HTML into something with `children` and `classList`.
 *
 * Injected rather than assumed, because this reader has two callers in two
 * runtimes: the canvas, in a browser that has `DOMParser`, and the Builder,
 * on a server that does not. The alternative was a second parser for the
 * same markup — and a second parser is a second answer to "what is on this
 * page", which is exactly what the one-field rule exists to prevent.
 */
export type Parse = (html: string) => { body: { childNodes: Iterable<Node> } };

const browserParse: Parse = (html) =>
  new DOMParser().parseFromString(html, "text/html");

/**
 * The blocks in a page.
 *
 * Everything it cannot name is kept whole as an `html` block, so opening
 * the block editor on a page written by hand never loses a line of it.
 */
export function toBlocks(html: string, parse: Parse = browserParse): Block[] {
  if (!html.trim()) return [];
  const doc = parse(`<body>${html}</body>`);
  const out: Block[] = [];
  for (const node of [...doc.body.childNodes]) {
    if (node.nodeType === 3) {
      // Loose text between tags is still someone's writing.
      const loose = (node.textContent ?? "").trim();
      if (loose) out.push({ id: newId(10), kind: "text", text: loose });
      continue;
    }
    if (node.nodeType === 8) {
      // A comment between sections is the author's note about their own
      // page. It draws nothing, but dropping it here would quietly delete
      // it from the HTML field the moment someone opened this list.
      out.push({
        id: newId(10),
        kind: "html",
        html: `<!--${(node as Comment).data}-->`,
      });
      continue;
    }
    if (node.nodeType !== 1) continue;
    out.push(read(node as Element));
  }
  return out;
}

/**
 * Elements that are part of the page and draw none of it.
 *
 * Three different reasons, one consequence. A `<style>` or a font `<link>`
 * is the design but has no box. `<meta>`, `<title>` and `<base>` are
 * document scaffolding, which the sanitiser strips silently. A `<script>`
 * is refused outright, because nothing in that frame may run.
 *
 * All three are places a cursor cannot go, so none of them is a position on
 * the page — and counting one as a position shifts every position after it.
 */
const INERT =
  /<(style|script|title|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>|<(?:link|meta|base)\b[^>]*>|<!--[\s\S]*?-->/gi;

/**
 * True for a block that renders nothing a person could point at.
 *
 * Measured by taking the inert elements out and seeing whether anything is
 * left, rather than by matching the tag it starts with: a block the author
 * typed by hand may hold several, and a block that holds a `<style>` *and*
 * a `<div>` draws something.
 *
 * Why this has to be right: the editor addresses a block on the page by
 * position, and the two counts — blocks on the left, elements in the frame —
 * must agree or editing is switched off. A page pasted from a saved
 * document arrives with six of these in front of the design, so getting the
 * set wrong is the difference between editing that design and being told
 * you cannot.
 */
export const rendersNothing = (block: Block): boolean =>
  block.kind === "html" && block.html.replace(INERT, "").trim() === "";

/**
 * The positions in `blocks` of the blocks that draw something, in order.
 *
 * This is the map between the two editors: position *n* in the frame is
 * `drawnPositions(blocks)[n]` in the list. One function, because a second
 * copy of this arithmetic is a second answer to "which block did they just
 * click on", and the wrong answer lands an edit on the wrong block.
 */
export const drawnPositions = (blocks: Block[]): number[] =>
  blocks.flatMap((block, index) => (rendersNothing(block) ? [] : [index]));

/**
 * The same set, for a live node in the frame.
 *
 * `ShopHtml` walks the rendered document and `rendersNothing` reads a
 * block's source; they are two sides of one count, so the set they skip is
 * declared once here rather than written out in both places.
 */
export const INERT_TAGS = [
  "STYLE",
  "LINK",
  "SCRIPT",
  "META",
  "TITLE",
  "BASE",
  "NOSCRIPT",
];

/**
 * What a hand-written block *is*, in the two or three words a list row has
 * room for: the tag it opens with and the first class on it. Sixty
 * characters of source said `<div class="stage"><div class="device"><div`
 * for a whole page, which names nothing; `div.stage` at least points at it.
 */
export function htmlShape(html: string): string {
  const open = /<([a-z][a-z0-9-]*)\b([^>]*)>/i.exec(html.trim());
  if (!open) return "text";
  const tag = (open[1] ?? "").toLowerCase();
  const cls = /class\s*=\s*"([^"]*)"|class\s*=\s*'([^']*)'/i.exec(
    open[2] ?? "",
  );
  const first = (cls?.[1] ?? cls?.[2] ?? "").trim().split(/\s+/)[0];
  return first ? `${tag}.${first}` : tag;
}

// ------------------------------------------------------------- arranging

export const moveBlock = (
  blocks: Block[],
  from: number,
  to: number,
): Block[] => {
  if (to < 0 || to >= blocks.length || from === to) return blocks;
  const next = [...blocks];
  const [held] = next.splice(from, 1);
  if (held) next.splice(to, 0, held);
  return next;
};

/**
 * What changed between two versions of a page, in one line.
 *
 * Counted over blocks rather than characters, because that is the unit the
 * list is made of. Here rather than in the screen so the sentence stored
 * with a turn and the sentence shown beside it are the same sentence: two
 * of these would be two answers to "what did it do".
 */
export function blockDifference(before: Block[], after: Block[]): string {
  const say = (blocks: Block[]) =>
    blocks.map((block) => JSON.stringify({ ...block, id: 0 }));
  const was = say(before);
  const now = say(after);
  const kept = new Set(was.filter((one) => now.includes(one)));
  const added = now.filter((one) => !kept.has(one)).length;
  const gone = was.filter((one) => !kept.has(one)).length;
  return [
    added > 0 ? `${added} new` : null,
    gone > 0 ? `${gone} gone` : null,
    `${kept.size} unchanged`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Where a row dropped on another row actually lands.
 *
 * Two off-by-ones live here and nowhere else. The gap you aimed at is
 * *above* the row you released over, or below it, which is the `after`
 * half; and `moveBlock` takes the row out before putting it back, so every
 * index past the one you lifted has already shifted down by one.
 *
 * Pure, so the arithmetic is held by a test rather than by dragging things
 * around in a browser and squinting.
 */
export const dropIndex = (
  from: number,
  over: number,
  after: boolean,
): number => {
  const to = over + (after ? 1 : 0);
  return from < to ? to - 1 : to;
};

export const insertBlock = (blocks: Block[], at: number, block: Block) => [
  ...blocks.slice(0, at),
  block,
  ...blocks.slice(at),
];

export const removeBlock = (blocks: Block[], at: number) =>
  blocks.filter((_, index) => index !== at);

/** A copy, with its own id, directly below. */
export const duplicateBlock = (blocks: Block[], at: number): Block[] => {
  const held = blocks[at];
  if (!held) return blocks;
  return insertBlock(blocks, at + 1, { ...held, id: newId(10) });
};

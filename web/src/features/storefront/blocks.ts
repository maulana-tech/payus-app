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
  | { id: string; kind: "divider" }
  /** Anything written by hand that the reader did not recognise. */
  | { id: string; kind: "html"; html: string };

export type BlockKind = Block["kind"];

/** What the "add" menu offers, in the order it offers them. */
export const BLOCK_KINDS: { kind: BlockKind; label: string; hint: string }[] = [
  { kind: "heading", label: "Heading", hint: "A section heading" },
  { kind: "text", label: "Text", hint: "A paragraph" },
  { kind: "lead", label: "Lead", hint: "A larger opening line" },
  { kind: "quiet", label: "Quiet", hint: "A smaller, softer line" },
  { kind: "list", label: "List", hint: "Bulleted or numbered" },
  { kind: "card", label: "Card", hint: "A panel in the shop's colours" },
  {
    kind: "columns",
    label: "Two columns",
    hint: "Side by side on a wide screen",
  },
  { kind: "quote", label: "Quote", hint: "A pulled quote" },
  { kind: "image", label: "Image", hint: "By https address" },
  { kind: "link", label: "Link", hint: "Opens in a new tab" },
  { kind: "cta", label: "Pay link", hint: "A button to one of your pay links" },
  { kind: "divider", label: "Divider", hint: "A rule between sections" },
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
    case "divider":
      return { id, kind };
    default:
      return { id, kind: "text", text: "" };
  }
}

// ---------------------------------------------------------------- writing

const esc = (text: string) =>
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
      // A class we do not write is a class we must not drop.
      if (el.classList.length > 0) return kept();
      return { id, kind: "text", text: text(el) };
    }
    case "UL":
    case "OL": {
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
    case "DIV":
      return asCard(el) ?? asColumns(el) ?? kept();
    default:
      return kept();
  }
}

/**
 * The blocks in a page.
 *
 * Needs a DOM, so this runs in the browser — the canvas is a client
 * component and the one place it is called. Everything it cannot name is
 * kept whole as an `html` block, so opening the block editor on a page
 * written by hand never loses a line of it.
 */
export function toBlocks(html: string): Block[] {
  if (!html.trim()) return [];
  const doc = new DOMParser().parseFromString(
    `<body>${html}</body>`,
    "text/html",
  );
  const out: Block[] = [];
  for (const node of [...doc.body.childNodes]) {
    if (node.nodeType === 3) {
      // Loose text between tags is still someone's writing.
      const loose = (node.textContent ?? "").trim();
      if (loose) out.push({ id: newId(10), kind: "text", text: loose });
      continue;
    }
    if (node.nodeType !== 1) continue;
    out.push(read(node as Element));
  }
  return out;
}

/**
 * True for a block that renders nothing a person could point at.
 *
 * A `<style>` or a font `<link>` is part of the page and must be kept, but
 * it draws nothing — so it is not a position in the page you can click, and
 * it must not be counted as one. The sanitiser also lifts every `<style>`
 * into a single block at the front, so counting raw elements against
 * rendered ones without this gets different answers and the editor refuses
 * to work at all.
 */
export const rendersNothing = (block: Block): boolean =>
  block.kind === "html" &&
  /^\s*<(style|link)\b[\s\S]*$/i.test(block.html) &&
  !/<(?!\/?(style|link)\b)[a-z]/i.test(block.html);

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

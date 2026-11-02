import "server-only";
import sanitizeHtml from "sanitize-html";

// Merchants (and the Builder) may write HTML for the top of their shop.
// Nothing written here is ever rendered as given: it passes this allowlist
// first, and what survives is stored alongside the original so the editor
// can show the author what they actually wrote.
//
// Two layers, deliberately:
//   1. this allowlist, which drops anything that could execute; and
//   2. a sandboxed iframe with scripting switched off, so that even a hole
//      in layer 1 executes in an opaque origin with no access to the page,
//      its cookies, or the Payus session.
//
// Writing a sanitiser by hand is how people get this wrong, so the work is
// done by `sanitize-html` and this file only decides the policy.

export const MAX_HTML = 8_000;

const POLICY: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "hr",
    "h2",
    "h3",
    "h4",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "mark",
    "small",
    "ul",
    "ol",
    "li",
    "blockquote",
    "figure",
    "figcaption",
    "a",
    "img",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "div",
    "span",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    "*": ["class"],
  },
  // No inline styles: a shop's colours come from its theme, and `style`
  // is a reliable way to hide or overlay things on a page that takes money.
  allowedClasses: { "*": [/^shop-[a-z-]{1,24}$/] },
  // Only addresses a browser cannot be tricked by: no javascript:, no data:,
  // no vbscript:.
  allowedSchemes: ["https", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    // Any link out of a shop is a stranger's link.
    a: sanitizeHtml.simpleTransform("a", {
      target: "_blank",
      rel: "noopener noreferrer nofollow ugc",
    }),
    img: sanitizeHtml.simpleTransform("img", { loading: "lazy" }),
  },
};

export type Sanitized = {
  /** What the author wrote, kept so the editor can show it back. */
  raw: string;
  /** What will be rendered. Never anything else. */
  clean: string;
  /** Tags that were dropped, so the author is told rather than puzzled. */
  removed: string[];
};

const TAG = /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/g;

const tagsIn = (html: string): Set<string> => {
  const found = new Set<string>();
  for (const [, tag] of html.matchAll(TAG)) found.add(tag.toLowerCase());
  return found;
};

/** Runs the policy and reports what it took out. */
export function sanitizeShopHtml(input: string): Sanitized {
  const raw = input.slice(0, MAX_HTML);
  const clean = sanitizeHtml(raw, POLICY);
  const before = tagsIn(raw);
  const after = tagsIn(clean);
  const removed = [...before].filter((tag) => !after.has(tag)).sort();
  return { raw, clean, removed };
}

import "server-only";
import sanitizeHtml from "sanitize-html";
import { MAX_HTML } from "@/features/storefront/config";
import { sanitizeShopCss } from "./css";

// Merchants (and the Builder) may write the top of their shop themselves.
// Nothing written here is ever rendered as given: it passes this allowlist
// first, and what survives is stored alongside the original so the editor
// can show the author what they actually wrote.
//
// Two layers, and they are not the same size on purpose:
//
//   1. a sandboxed iframe **without `allow-scripts`**, which is the fence
//      that protects the page. Nothing inside it runs, its CSS is scoped to
//      its own document, and `position: fixed` in there is fixed to a box
//      the height of the prose — not over the button that takes money. That
//      layer does not move.
//   2. this allowlist, which is calibrated for what layer 1 does *not*
//      stop: a request to a third party at render time, a link a browser
//      can be tricked by, and markup that would frame or navigate.
//
// It used to be calibrated for prose — a handful of tags, no classes of an
// author's own and no stylesheet at all — and a whole design pasted in came
// out as a column of unstyled text. Widening it to a document is the point
// of this file now; what it still refuses is listed above, and it refuses
// those because the sandbox cannot.
//
// Writing a sanitiser by hand is how people get this wrong, so the work is
// done by `sanitize-html` and `css-tree`, and these files decide policy.

export { MAX_HTML };

const TEXT = [
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "mark",
  "small",
  "sub",
  "sup",
  "abbr",
  "cite",
  "q",
  "time",
  "code",
  "kbd",
  "samp",
  "pre",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "blockquote",
];

const STRUCTURE = [
  "div",
  "span",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "aside",
  "nav",
  "figure",
  "figcaption",
  "details",
  "summary",
  "picture",
  "source",
];

const TABLE = [
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
];

// Inline SVG, for the chevrons and rules a design is drawn with. No
// `foreignObject` (it reopens arbitrary HTML) and no `script` (the sandbox
// already refuses it, and so does this list).
const SVG = [
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "marker",
  "mask",
  "clippath",
  "lineargradient",
  "radialgradient",
  "stop",
  "pattern",
];

const POLICY: sanitizeHtml.IOptions = {
  allowedTags: [...TEXT, ...STRUCTURE, ...TABLE, ...SVG, "a", "img", "style"],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: [
      "src",
      "alt",
      "title",
      "width",
      "height",
      "loading",
      "srcset",
      "sizes",
    ],
    source: ["srcset", "sizes", "type", "media"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan", "scope"],
    col: ["span"],
    colgroup: ["span"],
    details: ["open"],
    time: ["datetime"],
    ol: ["start", "reversed", "type"],
    // SVG is geometry, and geometry is a long list of harmless numbers.
    "*": [
      "class",
      "id",
      "style",
      "role",
      "aria-label",
      "aria-hidden",
      "aria-labelledby",
      "aria-describedby",
      "lang",
      "dir",
      "hidden",
      "viewbox",
      "xmlns",
      "fill",
      "stroke",
      "stroke-width",
      "stroke-linecap",
      "stroke-linejoin",
      "stroke-dasharray",
      "stroke-dashoffset",
      "opacity",
      "fill-opacity",
      "stroke-opacity",
      "d",
      "cx",
      "cy",
      "r",
      "rx",
      "ry",
      "x",
      "y",
      "x1",
      "y1",
      "x2",
      "y2",
      "points",
      "width",
      "height",
      "transform",
      "offset",
      "stop-color",
      "stop-opacity",
      "gradientunits",
      "patternunits",
      "preserveaspectratio",
      "clip-path",
      "mask",
      "text-anchor",
      "dominant-baseline",
      "font-size",
      "font-weight",
      "href",
      "aria-current",
    ],
  },
  // Only addresses a browser cannot be tricked by: no javascript:, no data:,
  // no vbscript:. `#` is kept so a page can link to its own sections.
  allowedSchemes: ["https", "mailto"],
  allowedSchemesByTag: { img: ["https"], use: [], a: ["https", "mailto"] },
  allowedSchemesAppliedToAttributes: ["href", "src", "srcset"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  // `style` would otherwise be thrown away with its contents, which is
  // exactly the bug this file is here to fix. Its text is sanitised below.
  nonTextTags: [
    "script",
    "textarea",
    "option",
    "noscript",
    "iframe",
    "object",
    "embed",
  ],
  allowVulnerableTags: true,
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
  /** What was taken out, so the author is told rather than puzzled. */
  removed: string[];
};

const TAG = /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/g;

const tagsIn = (html: string): Set<string> => {
  const found = new Set<string>();
  for (const [, tag] of html.matchAll(TAG)) found.add(tag.toLowerCase());
  return found;
};

/**
 * The wrappers a whole saved page arrives in. These carry nothing of their
 * own and go without comment — being told that `<html>` was removed is not
 * news to anyone. `<title>` takes its text with it: the allowlist would
 * otherwise drop the tag and leave the words, so a pasted page would open
 * with its own filename printed across the top.
 */
const SCAFFOLD =
  /<\/?(?:html|head|body)(?:\s[^>]*)?>|<!doctype[^>]*>|<title(?:\s[^>]*)?>[\s\S]*?<\/title>|<meta\b[^>]*>|<base\b[^>]*>/gi;

/** Link relations that ask for no stylesheet, and so take no design with them. */
const QUIET_REL =
  /rel\s*=\s*["']?(?:preconnect|dns-prefetch|preload|prefetch|icon|shortcut icon|apple-touch-icon|manifest|canonical|alternate)/i;

/** `<style>…</style>`, wherever in the document it was written. */
const STYLE_BLOCK = /<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi;

/** A stylesheet `<link>`, which is how a design names its typeface. */
const LINK_TAG = /<link\b[^>]*>/gi;
const HREF = /href\s*=\s*["']([^"']+)["']/i;

/**
 * Pulls every stylesheet out of the document before the HTML allowlist runs,
 * turns a font `<link>` into the `@import` that means the same thing, and
 * drops the `<html>/<head>/<body>` wrappers — which carry nothing, and whose
 * removal was the first thing an author pasting a page was told about.
 */
function liftStyles(input: string): {
  body: string;
  css: string;
  notes: string[];
} {
  const notes: string[] = [];
  const sheets: string[] = [];

  let body = input.replace(STYLE_BLOCK, (_, css: string) => {
    sheets.push(css);
    return "";
  });

  body = body.replace(LINK_TAG, (tag) => {
    const href = HREF.exec(tag)?.[1];
    if (href && /^https:\/\/fonts\.googleapis\.com\//i.test(href)) {
      sheets.unshift(`@import url("${href.replace(/"/g, "%22")}");`);
      return "";
    }
    if (href && !QUIET_REL.test(tag))
      notes.push("a <link> to a stylesheet that is not a web font");
    return "";
  });

  body = body.replace(SCAFFOLD, "");
  return { body, css: sheets.join("\n"), notes };
}

/** Runs the policy and reports what it took out. */
export function sanitizeShopHtml(input: string): Sanitized {
  const raw = input.slice(0, MAX_HTML);
  const lifted = liftStyles(raw);
  const sheet = sanitizeShopCss(lifted.css);

  const body = sanitizeHtml(lifted.body, POLICY);
  // The author's stylesheet goes back in ahead of the markup, so it is one
  // block in a known place rather than scattered where it happened to sit.
  const clean = sheet.css ? `<style>${sheet.css}</style>${body}` : body;

  const before = tagsIn(lifted.body);
  const after = tagsIn(body);
  const removed = [
    ...[...before].filter((tag) => !after.has(tag)),
    ...lifted.notes,
    ...sheet.notes,
  ];
  return { raw, clean, removed: [...new Set(removed)].sort() };
}

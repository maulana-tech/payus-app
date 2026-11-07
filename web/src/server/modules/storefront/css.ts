import "server-only";
import * as csstree from "css-tree";

// The merchant's own CSS.
//
// This exists because the iframe the shop's markup renders in has no
// `allow-scripts`, which is the fence that actually protects the page. CSS
// inside that frame is scoped to that frame's document: it cannot style the
// page around it, and `position: fixed` in there is fixed to a box that is
// only as tall as the prose. So the things CSS may still do are the things
// the sandbox does *not* stop, and those are what this file takes out:
//
//   - a request to a third party at render time (`@import`, `url()`), which
//     hands a visitor's address to someone the shopper never chose; and
//   - the handful of legacy properties that were ever able to run code.
//
// Parsing is done by `css-tree` rather than by regular expressions. A
// sanitiser written against the text of a language it does not parse is a
// sanitiser with a hole in it; this file only decides the policy.

/** At-rules a page can be built out of. Everything else is dropped. */
const AT_RULES = new Set([
  "media",
  "supports",
  "container",
  "layer",
  "scope",
  "font-face",
  "keyframes",
  "-webkit-keyframes",
  "page",
  "property",
  "counter-style",
  "font-feature-values",
]);

/**
 * The only hosts a stylesheet may reach out to, and they are web fonts.
 * A design that brings its own typeface is most of what "bring your own
 * design" means, and these two are where that typeface comes from.
 */
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

/** Properties that could ever run something. All long dead; all cheap to keep out. */
const EXECUTABLE = /^(behavior|-ms-behavior|-moz-binding|binding)$/i;

/** Values that could ever run something, whatever the property. */
const EXECUTABLE_VALUE =
  /expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding/i;

const httpsUrl = (raw: string): URL | null => {
  const value = raw.trim().replace(/^['"]|['"]$/g, "");
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

export type SanitizedCss = {
  css: string;
  /** What was taken out, in words, so an author learns rather than wonders. */
  notes: string[];
};

/**
 * Runs the policy over one stylesheet and says what it took out.
 *
 * A stylesheet it cannot parse at all returns empty rather than partly
 * applied: half a stylesheet is a layout nobody designed.
 */
export function sanitizeShopCss(input: string): SanitizedCss {
  if (!input.trim()) return { css: "", notes: [] };

  const notes = new Set<string>();
  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(input, { positions: false });
  } catch {
    return { css: "", notes: ["CSS that could not be parsed"] };
  }

  // Walk once, removing as we go. `list.remove(item)` is why the walk is
  // given the item and its list rather than only the node.
  csstree.walk(ast, {
    enter(
      node: csstree.CssNode,
      item: csstree.ListItem<csstree.CssNode> | undefined,
      list: csstree.List<csstree.CssNode> | undefined,
    ) {
      if (!item || !list) return;

      if (node.type === "Atrule") {
        const name = node.name.toLowerCase();
        if (name === "import") {
          const prelude = csstree.generate(
            node.prelude ?? { type: "Raw", value: "" },
          );
          const url = httpsUrl(prelude.replace(/^url\(|\)$/g, ""));
          if (!url || !FONT_HOSTS.has(url.hostname)) {
            notes.add("@import of a stylesheet that is not a web font");
            list.remove(item);
          }
          return;
        }
        if (!AT_RULES.has(name)) {
          notes.add(`@${name}`);
          list.remove(item);
        }
        return;
      }

      if (node.type === "Declaration") {
        if (EXECUTABLE.test(node.property)) {
          notes.add(`the ${node.property} property`);
          list.remove(item);
          return;
        }
        const value = csstree.generate(node.value);
        if (EXECUTABLE_VALUE.test(value)) {
          notes.add("a value that could run something");
          list.remove(item);
          return;
        }
        return;
      }

      if (node.type === "Url") {
        const url = httpsUrl(node.value);
        if (!url) {
          notes.add("a url() that is not https");
          list.remove(item);
        }
        return;
      }
    },
  });

  return { css: csstree.generate(ast), notes: [...notes].sort() };
}

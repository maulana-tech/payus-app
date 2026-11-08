"use client";

import { useEffect, useRef, useState } from "react";
import { INERT_TAGS } from "@/features/storefront/blocks";
import type { Palette } from "@/features/storefront/theme";

// The merchant's own HTML, rendered where it cannot reach the page around
// it. Two things make that true:
//
//   sandbox without `allow-scripts` — nothing inside can execute, so even a
//   tag the sanitiser let through is inert; and
//   `srcdoc` rather than a URL — there is no document to navigate to and no
//   network request that could carry anything out.
//
// `allow-same-origin` is present only so this page can measure the content
// and size the frame to it. Without `allow-scripts` it grants no ability to
// run anything; the pair together is the combination to avoid, not this one.

/**
 * What the canvas asks for when the page should be editable on the right.
 *
 * `index` is the position of a top-level element in the frame, which is
 * also the position of its block — `toBlocks` reads one block per top-level
 * element, so the two lists line up. The canvas only turns this on when it
 * has checked that they are the same length.
 */
export type ShopHtmlEdit = {
  onSelect: (index: number) => void;
  onEdit: (index: number, outerHtml: string) => void;
};

/**
 * The element's markup as its author would recognise it.
 *
 * `contenteditable` and `data-edit` are this editor's own, put on to make
 * the page clickable; reading `outerHTML` straight off the live node wrote
 * them back into the page and they turned up in the author's own markup
 * field. The sanitiser would have dropped them on the way out, which is
 * exactly why this had to be caught here instead.
 */
function written(node: HTMLElement): string {
  const copy = node.cloneNode(true) as HTMLElement;
  for (const el of [copy, ...copy.querySelectorAll("*")]) {
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-edit");
  }
  return copy.outerHTML;
}

export function ShopHtml({
  html,
  palette,
  edit,
}: {
  /** Already sanitised on the server. Never raw author input. */
  html: string;
  palette: Palette;
  /** The editor's hooks. Absent on every page the public is served. */
  edit?: ShopHtmlEdit;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);
  // `srcDoc` loads asynchronously, so an effect that runs on mount finds an
  // empty document. The measuring pass already waited for this through
  // `onLoad`; the editing pass has to wait for it too, and a counter rather
  // than a boolean so a second document re-runs it.
  const [loads, setLoads] = useState(0);

  const document = `<!doctype html><html><head><meta charset="utf-8">
<style>
  /* The shop's own palette, as variables, so an author's CSS can follow the
     theme the owner picked instead of hard-coding a colour that fights it
     the moment they switch. Concrete values are still interpolated below,
     so a page that uses none of these is unaffected. */
  :root {
    color-scheme: ${palette.scheme};
    --shop-page: ${palette.page};
    --shop-surface: ${palette.surface};
    --shop-fg: ${palette.text};
    --shop-muted: ${palette.muted};
    --shop-line: ${palette.line};
    --shop-accent: ${palette.accent};
    --shop-accent-text: ${palette.accentText};
  }
  body {
    margin: 0;
    font: 400 16px/1.65 var(--shop-font, ui-sans-serif, system-ui, sans-serif);
    color: ${palette.text};
    background: transparent;
    overflow-wrap: anywhere;
  }
  h2, h3, h4 { font-weight: 400; line-height: 1.2; margin: 1.4em 0 0.4em; }
  h2 { font-size: 1.5rem; } h3 { font-size: 1.2rem; } h4 { font-size: 1rem; }
  p, ul, ol, blockquote, figure, table { margin: 0 0 1em; }
  :first-child { margin-top: 0; }
  a { color: ${palette.accent}; }
  ul, ol { padding-left: 1.2em; }
  blockquote {
    margin-left: 0; padding-left: 1em;
    border-left: 2px solid ${palette.accent}; color: ${palette.muted};
  }
  hr { border: 0; border-top: 1px solid ${palette.line}; margin: 1.5em 0; }
  img { max-width: 100%; height: auto; border-radius: 12px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid ${palette.line}; padding: 0.5em 0; text-align: left; }
  small, figcaption { color: ${palette.muted}; font-size: 0.875rem; }
  /* The shop- classes: a few shapes for an author who does not want to
     write a stylesheet. An author who does write one gets their own class
     names too, and their rules are emitted after these, so theirs win. */
  .shop-lead { font-size: 1.2rem; line-height: 1.5; }
  .shop-muted { color: ${palette.muted}; font-size: 0.9375rem; }
  .shop-center { text-align: center; }
  .shop-cols { display: grid; gap: 1.25rem; grid-template-columns: 1fr 1fr; }
  .shop-card {
    border: 1px solid ${palette.line};
    background: ${palette.surface};
    border-radius: 16px;
    padding: 1.25rem;
  }
  .shop-card > :last-child { margin-bottom: 0; }
  /* A link that is an action: the shop's accent, at a size a thumb can
     hit. It is still a link — nothing in this frame can take a payment. */
  .shop-cta {
    display: inline-flex; align-items: center; justify-content: center;
    min-height: 44px; padding: 0 1.25rem; border-radius: 12px;
    background: ${palette.accent}; color: ${palette.accentText};
    font-weight: 500; text-decoration: none;
  }
  .shop-cta:hover { filter: brightness(1.06); }
  @media (max-width: 520px) { .shop-cols { grid-template-columns: 1fr; } }
</style></head><body>${html}</body></html>`;

  // Measuring the frame is the whole reason `allow-same-origin` is here, and
  // it has to survive a design that arrives before its typeface does. A
  // single timeout was enough when this held prose in a font the page
  // already had; a web font lands whenever the network says so, and every
  // line reflows when it does. So: measure on load, again when the fonts
  // report ready, and then keep watching, because a grid that rewraps at a
  // container query is a height change nobody fired an event for.
  //
  // The dependency is `loads`, not `html`: a new `html` only matters here
  // because it replaces the frame's document, and `loads` is when that has
  // actually happened. Watching `html` ran this against the *old* body —
  // on first render, against the empty one that `srcDoc` then replaces.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `loads` is a trigger, not something the effect reads.
  useEffect(() => {
    let alive = true;
    const measure = () => {
      const body = frame.current?.contentDocument?.body;
      if (!alive || !body) return;
      const next = Math.ceil(body.getBoundingClientRect().height);
      // Only grow or shrink on a real change: setting state to the number it
      // already holds on every observer tick is a render loop.
      setHeight((current) => (current === next ? current : next));
    };

    measure();
    window.addEventListener("resize", measure);

    const doc = frame.current?.contentDocument;
    // `fonts.ready` resolves immediately when there is nothing to wait for,
    // so this costs nothing for a shop that brought no typeface.
    doc?.fonts?.ready.then(measure).catch(() => {});

    const observer =
      doc?.body && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    if (doc?.body) observer?.observe(doc.body);

    return () => {
      alive = false;
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [loads]);

  // Editing happens from *this* document, not from inside the frame.
  // `allow-same-origin` lets the parent reach in; the frame still has no
  // `allow-scripts`, so nothing the author wrote can run. That is the whole
  // reason this is safe, and it is why the sandbox did not have to change.
  //
  // `loads` is the dependency for the same reason as above: a document that
  // has just loaded is new elements to make editable.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `loads` is a trigger, not something the effect reads.
  useEffect(() => {
    if (!edit) return;
    const doc = frame.current?.contentDocument;
    const body = doc?.body;
    if (!doc || !body) return;

    const style = doc.createElement("style");
    style.textContent = `
      [data-edit] { outline: 1px dashed transparent; outline-offset: 4px;
                    border-radius: 4px; transition: outline-color .12s; }
      [data-edit]:hover { outline-color: ${palette.accent}; cursor: text; }
      [data-edit]:focus { outline: 2px solid ${palette.accent};
                          outline-offset: 4px; }
    `;
    doc.head.append(style);

    // Positions are counted over what is drawn. A `<style>` is in the
    // document and renders nothing, so it is not somewhere a cursor can
    // go — and counting it would shift every position after it.
    const nodes = ([...body.children] as HTMLElement[]).filter(
      (node) => !INERT_TAGS.includes(node.tagName),
    );
    const timers = new Map<number, ReturnType<typeof setTimeout>>();

    nodes.forEach((node, index) => {
      node.setAttribute("data-edit", "");
      // `plaintext-only`: a person editing their page should not be able to
      // paste markup into it by accident, and the sanitiser should not be
      // the thing that discovers they did.
      node.setAttribute("contenteditable", "plaintext-only");
      node.addEventListener("focus", () => edit.onSelect(index));
      node.addEventListener("input", () => {
        clearTimeout(timers.get(index));
        timers.set(
          index,
          setTimeout(() => edit.onEdit(index, written(node)), 400),
        );
      });
    });

    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      style.remove();
      for (const node of nodes) {
        node.removeAttribute("data-edit");
        node.removeAttribute("contenteditable");
      }
    };
  }, [edit, loads, palette.accent]);

  if (!html.trim()) return null;

  return (
    <iframe
      ref={frame}
      title="About this shop"
      // Still no `allow-scripts`: that is the fence, and it does not move.
      //
      // `allow-popups` is here because without it every link a merchant
      // writes is dead — the sanitiser forces `target="_blank"`, and a
      // frame that may not open a window swallows the click in silence.
      // `allow-popups-to-escape-sandbox` so the tab that opens is an
      // ordinary tab; inheriting this sandbox would break the page it
      // lands on. Nothing in here can script, so the only thing that can
      // open a window is a person clicking a link we sanitised to https or
      // mailto, carrying `rel="noopener noreferrer"`.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={document}
      onLoad={() => {
        const body = frame.current?.contentDocument?.body;
        if (body) setHeight(Math.ceil(body.getBoundingClientRect().height));
        setLoads((n) => n + 1);
      }}
      // The frame is sized to its content, so its own scrollbar would only
      // ever be a second one inside the page's.
      scrolling="no"
      style={{ height: height || 160 }}
      className="w-full border-0"
    />
  );
}

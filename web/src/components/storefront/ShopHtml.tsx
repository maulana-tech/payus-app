"use client";

import { useEffect, useRef, useState } from "react";
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

export function ShopHtml({
  html,
  palette,
}: {
  /** Already sanitised on the server. Never raw author input. */
  html: string;
  palette: Palette;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: `html` is not
  // read inside the effect — it is the reason to re-run it. A new document
  // is a new body, and the observer must be pointed at that one.
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
    // `html` is a dependency because a new document is a new body to watch:
    // the editor replaces this frame's contents on every keystroke.
  }, [html]);

  if (!html.trim()) return null;

  return (
    <iframe
      ref={frame}
      title="About this shop"
      // No allow-scripts: nothing in here runs, whatever it says.
      sandbox="allow-same-origin"
      srcDoc={document}
      onLoad={() => {
        const body = frame.current?.contentDocument?.body;
        if (body) setHeight(Math.ceil(body.getBoundingClientRect().height));
      }}
      // The frame is sized to its content, so its own scrollbar would only
      // ever be a second one inside the page's.
      scrolling="no"
      style={{ height: height || 160 }}
      className="w-full border-0"
    />
  );
}

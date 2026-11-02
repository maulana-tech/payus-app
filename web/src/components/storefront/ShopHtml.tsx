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
  :root { color-scheme: ${palette.scheme}; }
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
  /* The allowlisted classes: shop- is the only prefix the sanitiser keeps,
     and these are what it keeps it for — a writer gets a few shapes
     without getting a stylesheet. */
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

  useEffect(() => {
    const measure = () => {
      const body = frame.current?.contentDocument?.body;
      if (body) setHeight(Math.ceil(body.getBoundingClientRect().height));
    };
    measure();
    window.addEventListener("resize", measure);
    const timer = setTimeout(measure, 120); // after webfonts settle
    return () => {
      window.removeEventListener("resize", measure);
      clearTimeout(timer);
    };
  }, []);

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
      style={{ height: height || 160 }}
      className="w-full border-0"
    />
  );
}

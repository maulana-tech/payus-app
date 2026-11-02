import { describe, expect, it } from "vitest";
import { sanitizeShopHtml } from "../src/server/modules/storefront/sanitize";

// A merchant may write HTML for their shop. These are the cases that decide
// whether that is safe: everything that could execute, navigate somewhere
// unexpected, or cover the page has to come out.

const clean = (html: string) => sanitizeShopHtml(html).clean;

describe("shop html", () => {
  it("keeps the writing", () => {
    const out = clean(
      "<h2>Our beans</h2><p>Roasted <strong>every Friday</strong>.</p><ul><li>Gayo</li></ul>",
    );
    expect(out).toContain("<h2>Our beans</h2>");
    expect(out).toContain("<strong>every Friday</strong>");
    expect(out).toContain("<li>Gayo</li>");
  });

  it("drops anything that runs", () => {
    expect(clean("<script>alert(1)</script><p>hi</p>")).toBe("<p>hi</p>");
    expect(clean('<img src="https://x/y.png" onerror="alert(1)">')).not.toMatch(
      /onerror/,
    );
    expect(clean('<p onclick="steal()">hi</p>')).toBe("<p>hi</p>");
    expect(clean("<svg><script>alert(1)</script></svg>")).not.toMatch(/script/);
  });

  it("drops anything that frames or asks for input", () => {
    for (const html of [
      '<iframe src="https://evil.test"></iframe>',
      "<form action=/x><input name=card></form>",
      '<object data="x.swf"></object>',
      "<embed src=x>",
      '<link rel=stylesheet href="https://evil.test/a.css">',
      "<style>body{display:none}</style>",
      "<base href='https://evil.test/'>",
    ])
      expect(clean(html)).not.toMatch(
        /iframe|form|input|object|embed|link|style|base/,
      );
  });

  it("refuses addresses a browser can be tricked by", () => {
    expect(clean('<a href="javascript:alert(1)">x</a>')).not.toMatch(
      /javascript:/,
    );
    expect(clean('<a href="data:text/html,<script>">x</a>')).not.toMatch(
      /data:/,
    );
    expect(clean('<img src="http://insecure.test/a.png">')).not.toMatch(
      /http:/,
    );
    expect(clean('<a href="//evil.test">x</a>')).not.toMatch(/evil/);
  });

  it("keeps a real link, and makes it a stranger's link", () => {
    const out = clean('<a href="https://example.com">our beans</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(out).toContain('target="_blank"');
  });

  it("refuses inline styles, which could hide or cover the page", () => {
    expect(clean('<p style="position:fixed;inset:0">x</p>')).toBe("<p>x</p>");
  });

  it("allows only the shop's own classes", () => {
    expect(clean('<p class="shop-lead">x</p>')).toContain('class="shop-lead"');
    expect(clean('<p class="fixed inset-0 z-50">x</p>')).toBe("<p>x</p>");
  });

  it("says what it took out, so the author is not left guessing", () => {
    const result = sanitizeShopHtml(
      "<p>hi</p><script>x</script><iframe></iframe>",
    );
    expect(result.removed).toEqual(["iframe", "script"]);
    expect(result.raw).toContain("<script>");
    expect(result.clean).not.toContain("<script>");
  });

  it("will not take an essay", () => {
    const long = `<p>${"a".repeat(20_000)}</p>`;
    expect(sanitizeShopHtml(long).raw.length).toBeLessThanOrEqual(8_000);
  });
});

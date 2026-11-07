import { describe, expect, it } from "vitest";
import { MAX_HTML } from "../src/features/storefront/config";
import { sanitizeShopHtml } from "../src/server/modules/storefront/sanitize";

// A merchant may bring their own design. These are the cases that decide
// whether that is safe.
//
// The fence that protects the page is not in this file: the shop's markup
// renders in an iframe with no `allow-scripts`, so nothing in here runs and
// its CSS is scoped to that frame's document. What this file holds down is
// the set of things that sandbox does *not* stop — a request to a third
// party at render time, an address a browser can be tricked by, and markup
// that would frame, navigate or ask for input.
//
// That is why a `position: fixed` rule is allowed here and a `url(http://…)`
// is not, which looks backwards until you remember where the page is.

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

  it("takes a whole saved page and keeps its design", () => {
    // The case this policy exists for: someone exports a page and pastes it.
    // The wrappers carry nothing, so they go; the stylesheet is the design,
    // so it stays.
    const out = clean(
      `<!doctype html><html><head><meta charset="utf-8"><title>Shop</title>
       <style>.col{max-width:1152px;margin:0 auto;border-inline:1px solid #e0e2eb}
       .hatch{height:16px;background:repeating-linear-gradient(-45deg,#e0e2eb 0 1px,transparent 1px 7px)}</style>
       </head><body><section class="col"><h1>Finetune Library</h1>
       <div class="hatch"></div><p class="body-lg">Reports and playbooks.</p></section></body></html>`,
    );
    expect(out).toContain("max-width:1152px");
    expect(out).toContain("repeating-linear-gradient");
    expect(out).toContain('class="col"');
    expect(out).toContain('class="hatch"');
    expect(out).toContain("<h1>Finetune Library</h1>");
    // The scaffolding is gone, but nothing it wrapped went with it.
    expect(out).not.toMatch(/<html|<head|<body|<!doctype|<title|<meta/i);
  });

  it("keeps an author's own classes, ids and inline styles", () => {
    const out = clean(
      '<div id="hero" class="bar-in cv white" style="padding:8%;display:flex">x</div>',
    );
    expect(out).toContain('id="hero"');
    expect(out).toContain('class="bar-in cv white"');
    expect(out).toContain("padding:8%");
  });

  it("drops anything that runs", () => {
    expect(clean("<p>ok</p><script>alert(1)</script>")).toBe("<p>ok</p>");
    expect(clean('<p onclick="x()">ok</p>')).toBe("<p>ok</p>");
    expect(clean("<style>a{behavior:url(x.htc)}</style><p>ok</p>")).not.toMatch(
      /behavior/,
    );
    expect(
      clean("<style>a{width:expression(alert(1))}</style><p>ok</p>"),
    ).not.toMatch(/expression/);
  });

  it("drops anything that frames, navigates or asks for input", () => {
    const out = clean(
      '<iframe src="https://e.com"></iframe><form><input name="card"></form><object></object><embed>',
    );
    expect(out).not.toMatch(/iframe|form|input|object|embed/);
  });

  it("refuses addresses a browser can be tricked by", () => {
    expect(clean('<a href="javascript:alert(1)">x</a>')).not.toContain(
      "javascript:",
    );
    expect(clean('<img src="data:text/html;base64,PHN2Zz4=">')).not.toContain(
      "data:",
    );
    expect(clean('<img src="http://e.com/a.png">')).not.toContain("http://");
  });

  it("keeps a real link, and makes it a stranger's link", () => {
    const out = clean('<a href="https://example.com">Visit</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(out).toContain('target="_blank"');
  });

  // --- what the sandbox cannot stop: a request to a third party ----------

  it("refuses a stylesheet that would call a stranger at render time", () => {
    const out = sanitizeShopHtml(
      '<style>@import url("https://tracker.example/a.css");.a{color:red}</style><p>x</p>',
    );
    expect(out.clean).not.toContain("tracker.example");
    // The rest of the stylesheet survives: one bad line is not a reason to
    // throw away a design.
    expect(out.clean).toContain("color:red");
    expect(out.removed.join(" ")).toMatch(/@import/);
  });

  it("lets a web font through, by either spelling", () => {
    const viaImport = clean(
      '<style>@import url("https://fonts.googleapis.com/css2?family=Geist");</style><p>x</p>',
    );
    expect(viaImport).toContain("fonts.googleapis.com");

    // A <link> is how a design usually names its typeface, and it means the
    // same thing, so it is turned into the thing it means.
    const viaLink = clean(
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist"><p>x</p>',
    );
    expect(viaLink).toContain("@import");
    expect(viaLink).toContain("fonts.googleapis.com");
  });

  it("refuses a url() that is not https, wherever it is written", () => {
    const out = sanitizeShopHtml(
      "<style>.a{background:url(http://e.com/x.png)}.b{background:url(data:image/png;base64,AA)}.c{background:url(https://ok.example/x.png)}</style><p>x</p>",
    );
    expect(out.clean).not.toContain("http://e.com");
    expect(out.clean).not.toContain("data:image");
    expect(out.clean).toContain("https://ok.example/x.png");
    expect(out.removed.join(" ")).toMatch(/url\(\) that is not https/);
  });

  it("allows a layout that could not reach the page around it", () => {
    // `position: fixed` inside a frame with no scripting is fixed to a box
    // the height of the prose. It is a design choice, not a way out.
    const out = clean(
      "<style>.hero{position:fixed;inset:0;z-index:99}</style><div class='hero'>x</div>",
    );
    expect(out).toContain("position:fixed");
  });

  it("does not leave the page's own title printed across the top", () => {
    // The allowlist alone would drop the tag and keep the words, so a
    // pasted export would open with its filename as its first line.
    const out = sanitizeShopHtml(
      "<html><head><title>Finetune Library Landing Page</title></head><body><p>Beans</p></body></html>",
    );
    expect(out.clean).toBe("<p>Beans</p>");
    // And the scaffolding is not reported: being told <html> was removed is
    // not news, and a list of non-news is a list nobody reads.
    expect(out.removed).toEqual([]);
  });

  it("says nothing about a <link> that was never going to bring a design", () => {
    const out = sanitizeShopHtml(
      '<link rel="preconnect" href="https://fonts.gstatic.com"><p>x</p>',
    );
    expect(out.removed).toEqual([]);
  });

  it("lets an svg point at itself but not at somewhere else", () => {
    const own = clean(
      '<svg viewBox="0 0 24 24"><use href="#chev"/></svg><svg><symbol id="chev"><path d="m9 6 6 6"/></symbol></svg>',
    );
    expect(own).toContain('href="#chev"');
    expect(own).toContain('id="chev"');

    const away = clean('<svg><use href="https://e.com/sprite.svg#x"/></svg>');
    expect(away).not.toContain("e.com");
  });

  it("says what it took out, so the author is not left guessing", () => {
    const result = sanitizeShopHtml(
      '<script>x</script><iframe></iframe><style>@charset "utf-8";</style><p>ok</p>',
    );
    expect(result.clean).toBe("<p>ok</p>");
    expect(result.removed).toContain("iframe");
    expect(result.removed).toContain("script");
    expect(result.removed).toContain("@charset");
  });

  it("will not take an essay", () => {
    const long = `<p>${"a".repeat(MAX_HTML * 2)}</p>`;
    expect(sanitizeShopHtml(long).raw.length).toBeLessThanOrEqual(MAX_HTML);
  });
});

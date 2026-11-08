// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  BLOCK_KINDS,
  type Block,
  blankBlock,
  duplicateBlock,
  insertBlock,
  moveBlock,
  removeBlock,
  drawnPositions,
  htmlShape,
  rendersNothing,
  toBlocks,
  toHtml,
} from "../src/features/storefront/blocks";
import { storefrontInput } from "../src/features/storefront/config";
import { sanitizeShopHtml } from "../src/server/modules/storefront/sanitize";

// Two editors sit on one field: the block list and the HTML tab. That only
// works if a block survives the trip out to HTML and back, and if a page
// written by hand survives being opened in the block list.
//
// Everything below is that, in both directions.

/** Ids are minted on every read, so compare everything else. */
const shape = (blocks: Block[]) => blocks.map(({ id: _id, ...rest }) => rest);

describe("blocks", () => {
  it("brings every kind home unchanged", () => {
    // Not a hand-written sample: every kind the menu offers, so a kind
    // added without a reader cannot pass this file.
    const made = BLOCK_KINDS.map(({ kind }) => blankBlock(kind));
    expect(made).toHaveLength(BLOCK_KINDS.length);

    const back = toBlocks(toHtml(made));
    expect(shape(back)).toEqual(shape(made));
    // And nothing fell through to the escape hatch.
    expect(back.some((b) => b.kind === "html")).toBe(false);
  });

  it("survives a second trip, so editing is not a slow erosion", () => {
    const once = toBlocks(toHtml(BLOCK_KINDS.map((k) => blankBlock(k.kind))));
    const twice = toBlocks(toHtml(once));
    expect(shape(twice)).toEqual(shape(once));
  });

  it("keeps a hand-written page whole instead of flattening it", () => {
    const hand =
      '<section class="ft-col"><span class="ft-eyebrow">Bandung</span>' +
      "<h2>Roasted on Fridays</h2></section>";
    const [block, ...rest] = toBlocks(hand);
    expect(rest).toEqual([]);
    expect(block?.kind).toBe("html");
    // Verbatim: the editor may not understand it, but it may not lose it.
    expect(toHtml([block as Block])).toBe(hand);
  });

  it("refuses to read markup it only half recognises", () => {
    // A card with a third child is not this editor's card. Flattening it
    // would quietly drop the third child on the next save.
    const odd = '<div class="shop-card"><h3>A</h3><p>B</p><p>C</p></div>';
    expect(toBlocks(odd)[0]?.kind).toBe("html");

    // A paragraph carrying a class we never write keeps its markup too.
    expect(toBlocks('<p class="ft-lead">x</p>')[0]?.kind).toBe("html");
  });

  it("reads a paragraph that is only a link as a link", () => {
    const [block] = toBlocks('<p><a href="https://a.test">Go</a></p>');
    expect(block).toMatchObject({
      kind: "link",
      href: "https://a.test",
      text: "Go",
    });
  });

  it("escapes what a person typed, so text cannot become markup", () => {
    const html = toHtml([
      { id: "1", kind: "text", text: '<script>alert("x")</script> & "quoted"' },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    // And it comes back as the characters they typed.
    expect(toBlocks(html)[0]).toMatchObject({
      kind: "text",
      text: '<script>alert("x")</script> & "quoted"',
    });
  });

  it("writes a page the shop schema accepts", () => {
    const html = toHtml(BLOCK_KINDS.map(({ kind }) => blankBlock(kind)));
    const parsed = storefrontInput.safeParse({
      slug: "kopi-senja",
      title: "Kopi Senja",
      blurb: "",
      template: "shelf",
      theme: "paper",
      accent: "clay",
      html,
      products: [{ name: "Beans", description: "", price: "18.00" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("knows which blocks draw nothing", () => {
    // A stylesheet is part of the page and must be kept, but it is not a
    // place a cursor can go — and the canvas counts positions over what is
    // drawn, so getting this wrong turns in-place editing off entirely.
    const style = toBlocks("<style>.a{color:red}</style>")[0] as Block;
    const link = toBlocks(
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist">',
    )[0] as Block;
    expect(rendersNothing(style)).toBe(true);
    expect(rendersNothing(link)).toBe(true);

    // Markup that happens to contain a style still draws.
    const page = toBlocks(
      "<div><style>.a{color:red}</style><p>Hi</p></div>",
    )[0] as Block;
    expect(rendersNothing(page)).toBe(false);
    expect(rendersNothing(blankBlock("text"))).toBe(false);
    expect(rendersNothing(blankBlock("divider"))).toBe(false);
  });

  it("counts document scaffolding and a script as drawing nothing", () => {
    // A page pasted from a saved document arrives with these in front of
    // the design. Every one of them used to come back as a block that drew
    // something, which both filled the list with rows that are not on the
    // page and shifted every real position after them.
    for (const markup of [
      '<meta name="viewport" content="width=device-width">',
      '<meta charset="utf8">',
      "<title>Finetune Library</title>",
      '<base href="https://example.com/">',
      '<link rel="preconnect" href="https://fonts.gstatic.com">',
      "<script>const a = 1;</script>",
      "<!-- a note to self -->",
    ]) {
      const block = toBlocks(markup)[0];
      expect(block, markup).toBeDefined();
      expect(rendersNothing(block as Block), markup).toBe(true);
    }
  });

  it("agrees with the sanitiser about how many positions a pasted page has", () => {
    // This is the check the canvas makes before it lets anyone edit on the
    // page: positions in the list have to line up with elements in the
    // frame. They are two readings of two different strings — what the
    // author wrote, and what the sanitiser serves — so the only way they
    // agree is if both sides call the same things inert.
    const raw = `<style>:root{color-scheme:light}</style>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta charset="utf8">
<title>Finetune Library Landing Page</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist">
<style>.bar{position:sticky}.col{max-width:1152px}</style>
<div class="bar"><div class="bar-in">Lynk.id</div></div>
<div class="stage"><main class="lp"><h1>Hello</h1></main></div>
<script>document.body.classList.add("ready");</script>`;

    const { clean } = sanitizeShopHtml(raw);
    const mine = drawnPositions(toBlocks(raw));
    const theirs = drawnPositions(toBlocks(clean));
    expect(mine).toHaveLength(2);
    expect(theirs).toHaveLength(2);
    // And the same elements, in the same order.
    expect(
      mine.map((at) => htmlShape((toBlocks(raw)[at] as { html: string }).html)),
    ).toEqual(["div.bar", "div.stage"]);
  });

  it("names a hand-written block by its shape", () => {
    // Sixty characters of source read `<div class="stage"><div class=` for a
    // whole page, which names nothing a person could recognise.
    expect(htmlShape('<div class="stage"><main>Hi</main></div>')).toBe(
      "div.stage",
    );
    expect(htmlShape("<section><h2>Hi</h2></section>")).toBe("section");
    expect(htmlShape('<meta charset="utf8">')).toBe("meta");
    expect(htmlShape("<script>var a=1</script>")).toBe("script");
    expect(htmlShape("  ")).toBe("text");
  });

  it("moves, inserts, removes and duplicates", () => {
    const a = blankBlock("heading");
    const b = blankBlock("text");
    const c = blankBlock("divider");
    const list = [a, b, c];

    expect(moveBlock(list, 0, 2).map((x) => x.id)).toEqual([b.id, c.id, a.id]);
    // Off either end is a no-op, not a crash or a silent reorder.
    expect(moveBlock(list, 0, -1)).toBe(list);
    expect(moveBlock(list, 2, 3)).toBe(list);

    expect(removeBlock(list, 1).map((x) => x.id)).toEqual([a.id, c.id]);

    const inserted = insertBlock(list, 1, blankBlock("quote"));
    expect(inserted).toHaveLength(4);
    expect(inserted[1]?.kind).toBe("quote");

    const copied = duplicateBlock(list, 0);
    expect(copied).toHaveLength(4);
    expect(copied[1]?.kind).toBe("heading");
    // A copy is its own block, or moving one would move both.
    expect(copied[1]?.id).not.toBe(a.id);
  });
});

import {
  BLOCK_GROUPS,
  BLOCK_KINDS,
  type BlockGroup,
  blankBlock,
  esc,
  toHtml,
} from "@/features/storefront/blocks";

// The HTML tab's toolbar.
//
// **Derived from the blocks, not written out again.** These used to be a
// second copy of the same markup, which meant the Card the toolbar pasted
// and the Card the block editor wrote could drift apart — and when they
// did, a page built in one tab stopped being readable in the other. There
// is one writer, `toHtml`, and this asks it.
//
// So the two tabs are separate places to work and not separate
// vocabularies: whatever the block menu offers, the toolbar pastes, and
// what it pastes comes back as that block if you ever switch over.

/**
 * A pay button, as markup.
 *
 * Shared by the HTML toolbar and the block editor's "choose" button, so the
 * two cannot write a different button for the same link. Escaped the way
 * everything else is: a shop called `Tom & Jerry's` is a title, not the
 * start of an entity.
 */
export const payLinkHtml = (href: string, label: string) =>
  `<p><a class="shop-cta" href="${esc(href)}">${esc(label)}</a></p>\n`;

export type Snippet = {
  label: string;
  hint: string;
  body: string;
  group: BlockGroup;
};

export const SNIPPETS: Snippet[] = BLOCK_KINDS.map(
  ({ kind, label, hint, group }) => ({
    label,
    hint,
    group,
    // A trailing newline so two in a row do not end up on one line.
    body: `${toHtml([blankBlock(kind)])}\n`,
  }),
);

/** The toolbar's shelves, in order, each with what is on it. */
export const SNIPPET_GROUPS: { group: BlockGroup; items: Snippet[] }[] =
  BLOCK_GROUPS.map((group) => ({
    group,
    items: SNIPPETS.filter((snippet) => snippet.group === group),
  })).filter((shelf) => shelf.items.length > 0);

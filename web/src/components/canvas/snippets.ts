// What the toolbar puts in. Every one of these survives the sanitiser as
// written — the `shop-` classes are the ones `ShopHtml` styles, and they are
// the reason the class allowlist exists at all.

export const SNIPPETS: { label: string; hint: string; body: string }[] = [
  {
    label: "Heading",
    hint: "A section heading",
    body: "<h2>A heading</h2>\n",
  },
  {
    label: "Text",
    hint: "A paragraph",
    body: "<p>Something about the shop.</p>\n",
  },
  {
    label: "Lead",
    hint: "A larger opening line",
    body: '<p class="shop-lead">The line people read first.</p>\n',
  },
  {
    label: "List",
    hint: "A bulleted list",
    body: "<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>\n",
  },
  {
    label: "Two columns",
    hint: "Side by side, stacking on a phone",
    body: '<div class="shop-cols">\n  <div>\n    <h3>This</h3>\n    <p>And what it is.</p>\n  </div>\n  <div>\n    <h3>That</h3>\n    <p>And what it is.</p>\n  </div>\n</div>\n',
  },
  {
    label: "Card",
    hint: "A panel in the shop's own colours",
    body: '<div class="shop-card">\n  <h3>Opening hours</h3>\n  <p>Tuesday to Sunday, 8am until the beans run out.</p>\n</div>\n',
  },
  {
    label: "Table",
    hint: "Rows and columns",
    body: "<table>\n  <tr><th>Origin</th><th>Process</th></tr>\n  <tr><td>Gayo</td><td>Washed</td></tr>\n</table>\n",
  },
  {
    label: "Quote",
    hint: "A pulled quote",
    body: "<blockquote>What someone said about it.</blockquote>\n",
  },
  {
    label: "Link",
    hint: "An https link, opened in a new tab",
    body: '<p><a href="https://example.com">Somewhere else</a></p>\n',
  },
  {
    label: "Image",
    hint: "An image by https address",
    body: '<figure>\n  <img src="https://example.com/photo.jpg" alt="">\n  <figcaption>What it shows.</figcaption>\n</figure>\n',
  },
  {
    label: "Divider",
    hint: "A rule between sections",
    body: "<hr>\n",
  },
  {
    label: "Quiet",
    hint: "Muted small print",
    body: '<p class="shop-muted">The small print.</p>\n',
  },
];

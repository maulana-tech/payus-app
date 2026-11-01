import { describe, expect, it } from "vitest";
import { embedSnippet } from "../src/features/embed/snippet";

describe("embed snippet", () => {
  it("renders the attributes a merchant chose", () => {
    expect(
      embedSnippet("https://payus.app", {
        to: "dinar",
        link: "coffee",
        theme: "dark",
      }),
    ).toBe(
      '<script src="https://payus.app/embed.js" async\n        data-to="@dinar"\n        data-link="coffee"\n        data-theme="dark"></script>',
    );
  });

  it("ignores the amount for links (they carry their own) and escapes labels", () => {
    const s = embedSnippet("https://payus.app", {
      to: "dinar",
      link: "coffee",
      amount: "1",
      label: 'Tip "me" <3',
    });
    expect(s).not.toContain("data-amount");
    expect(s).toContain('data-label="Tip &quot;me&quot; &lt;3"');
  });
});

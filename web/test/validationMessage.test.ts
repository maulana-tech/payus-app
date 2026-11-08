import { describe, expect, it } from "vitest";
import { storefrontInput } from "../src/features/storefront/config";
import { readable } from "../src/server/trpc";

// What a person sees when a form is not filled in.
//
// tRPC's default puts the whole ZodError through JSON.stringify, so saving
// an empty shop printed this at someone who had simply not typed a name:
//
//   [ { "origin": "string", "code": "too_small", "minimum": 3,
//       "path": ["slug"], "message": "Use at least 3 characters." }, … ]
//
// Four objects, for one missing name. These cases hold the sentence that
// replaced it, and they run against real zod output rather than a fixture
// of what zod was once thought to produce.

const refusalFor = (input: unknown) => {
  const parsed = storefrontInput.safeParse(input);
  if (parsed.success) throw new Error("expected it to refuse");
  return readable(parsed.error);
};

const shop = (over: Record<string, unknown> = {}) => ({
  slug: "kopi-senja",
  title: "Kopi Senja",
  blurb: "",
  template: "shelf",
  theme: "paper",
  accent: "clay",
  html: "",
  products: [{ name: "Beans", description: "", price: "18.00" }],
  ...over,
});

describe("a validation failure", () => {
  it("names the field and says one thing about it", () => {
    const said = refusalFor(
      shop({
        slug: "",
        title: "",
        products: [{ name: "", description: "", price: "1.00" }],
      }),
    );

    expect(said).toContain("Address: Use at least 3 characters.");
    expect(said).toContain("Name: Give the shop a name.");
    // A list index reads as a position, not as a path segment.
    expect(said).toContain("Item 1 · Name: Give it a name.");
    // And it is prose, not a dump.
    expect(said).not.toContain('"code"');
    expect(said).not.toContain("too_small");
  });

  it("says one thing per field, not every rule that failed", () => {
    // An empty slug is both too short and the wrong shape. The second is
    // noise while the first is true.
    const said = refusalFor(shop({ slug: "" }));
    expect(said).toContain("Use at least 3 characters.");
    expect(said).not.toContain("lowercase letters");
  });

  it("falls back to the field's own key when it needs no translation", () => {
    const said = refusalFor(shop({ template: "nope" }));
    expect(said).toContain("Template:");
  });

  it("accepts a shop that is filled in", () => {
    expect(storefrontInput.safeParse(shop()).success).toBe(true);
  });
});

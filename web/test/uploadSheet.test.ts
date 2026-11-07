// @vitest-environment happy-dom
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ExtractError, extractSheet } from "@/features/uploads/extract";

// .xlsx is a zip, and the only parts that matter are the shared strings and
// the first sheet. Hand-read rather than depended on: the usual package has
// had a run of advisories, and what is needed here is one grid of values.

function sheet(rowsXml: string, shared: string[] = [], quote = '"') {
  const q = quote;
  const si = shared.map((v) => `<si><t>${v}</t></si>`).join("");
  const zip = zipSync({
    "xl/sharedStrings.xml": strToU8(`<sst>${si}</sst>`),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet><sheetData>${rowsXml.replaceAll('"', q)}</sheetData></worksheet>`,
    ),
  });
  return new File([zip as unknown as BlobPart], "book.xlsx");
}

describe("reading a spreadsheet", () => {
  it("resolves the shared strings a cell points at", async () => {
    const grid = await extractSheet(
      sheet(
        `<row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
         <row><c r="A2" t="s"><v>2</v></c><c r="B2"><v>2400</v></c></row>`,
        ["Client", "Amount", "Mill & Co"],
      ),
    );
    expect(grid).toEqual([
      ["Client", "Amount"],
      ["Mill & Co", "2400"],
    ]);
  });

  it("keeps a gap where a cell is missing instead of shifting the row left", async () => {
    // Without reading the r="C2" reference, "x" would land under column B
    // and every value after a blank cell would be one column out.
    const grid = await extractSheet(
      sheet(
        `<row><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c><c r="C1"><v>3</v></c></row>
         <row><c r="A2"><v>9</v></c><c r="C2" t="inlineStr"><is><t>x</t></is></c></row>`,
      ),
    );
    expect(grid[1]).toEqual(["9", "", "x"]);
  });

  it("reads attributes written with single quotes as well as double", async () => {
    const grid = await extractSheet(
      sheet(`<row><c r="A1" t="s"><v>0</v></c></row>`, ["Hello"], "'"),
    );
    expect(grid).toEqual([["Hello"]]);
  });

  it("says what is wrong rather than returning an empty grid", async () => {
    const empty = zipSync({ "xl/sharedStrings.xml": strToU8("<sst/>") });
    await expect(
      extractSheet(new File([empty as unknown as BlobPart], "book.xlsx")),
    ).rejects.toBeInstanceOf(ExtractError);
  });
});

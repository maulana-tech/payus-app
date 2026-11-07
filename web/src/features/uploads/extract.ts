// Getting the words out of a document, in the browser.
//
// Deliberately client-side. A PDF or a .docx is a container format with a
// long history of parser bugs, and the server has no reason to meet one:
// what it needs is the text, and the text is all it is ever sent. The bytes
// never leave the page.
//
// Both parsers are imported inside the functions, so nothing is downloaded
// until someone actually attaches a document — the same reason the canvas
// loads CodeMirror lazily.

export const MAX_TEXT_CHARS = 200_000;

export class ExtractError extends Error {}

/** What a document is worth reading as. */
export type Extracted = { name: string; text: string; truncated: boolean };

function cap(name: string, text: string): Extracted {
  const clean = text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (clean.length === 0)
    throw new ExtractError(
      `${name} has no text in it. A scan of a page is an image, and this reads words rather than pictures.`,
    );
  return {
    name,
    text: clean.slice(0, MAX_TEXT_CHARS),
    truncated: clean.length > MAX_TEXT_CHARS,
  };
}

async function fromPdf(file: File): Promise<Extracted> {
  const pdfjs = await import("pdfjs-dist");
  // The worker is a separate file; pointing at the one in the package keeps
  // the bundler in charge of where it lands.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  // Nothing in a document we are reading for its words should be allowed to
  // fetch or reach outside itself.
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useWorkerFetch: false,
    disableAutoFetch: true,
    isOffscreenCanvasSupported: false,
  });
  const doc = await task.promise;

  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " "),
    );
  }
  await task.destroy();
  return cap(file.name, pages.join("\n\n"));
}

async function fromDocx(file: File): Promise<Extracted> {
  const { unzipSync, strFromU8 } = await import("fflate");
  let entry: Uint8Array | undefined;
  try {
    const zip = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) => f.name === "word/document.xml",
    });
    entry = zip["word/document.xml"];
  } catch {
    throw new ExtractError(`${file.name} is not a readable .docx.`);
  }
  if (!entry) throw new ExtractError(`${file.name} has no document inside it.`);

  const xml = strFromU8(entry);
  // `<w:t>` holds the runs of text; `<w:p>` ends a paragraph and `<w:br/>`
  // a line. Everything else in there is formatting, which we are throwing
  // away on purpose — this is for reading, not for rendering.
  const text = xml
    .replace(/<w:br[^>]*\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, (_, inner: string) => inner)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
  return cap(file.name, text);
}

/**
 * Whatever was attached, as the CSV the rest of the app already reads.
 *
 * A spreadsheet is a table, and we have a table reader — so the only new
 * work is getting the grid out. Everything downstream (reconcile, import,
 * asking about it) then has one shape to handle instead of two.
 */
export async function extractCsv(file: File): Promise<string> {
  if (/\.xlsx$/i.test(file.name)) {
    const { toCsv } = await import("../../lib/csv");
    return toCsv(await extractSheet(file));
  }
  if (/\.xls$/i.test(file.name))
    throw new ExtractError(
      "That is the old Excel format. Save it as .xlsx or CSV and try again.",
    );
  return file.text();
}

/** Reads a document for its words. Throws with something a person can act on. */
export async function extractText(file: File): Promise<Extracted> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return fromPdf(file);
  if (name.endsWith(".docx")) return fromDocx(file);
  if (name.endsWith(".doc"))
    throw new ExtractError(
      "That is the old Word format. Save it as .docx or PDF and try again.",
    );
  if (/\.(txt|md)$/.test(name)) return cap(file.name, await file.text());
  throw new ExtractError("This reads PDF, .docx and plain text.");
}

/**
 * A spreadsheet, read as a table.
 *
 * .xlsx is a zip like .docx, so the same unzip serves. Two parts matter:
 * `sharedStrings.xml`, where every repeated string lives once, and the
 * first sheet, whose cells point into it by index. Everything else in
 * there is formatting.
 *
 * Hand-read rather than a dependency: the `xlsx` package has had a run of
 * advisories, and what is needed here is the values of one grid.
 */
export async function extractSheet(file: File): Promise<string[][]> {
  const { unzipSync, strFromU8 } = await import("fflate");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) =>
        f.name === "xl/sharedStrings.xml" ||
        /^xl\/worksheets\/sheet1\.xml$/.test(f.name),
    });
  } catch {
    throw new ExtractError(`${file.name} is not a readable .xlsx.`);
  }

  const sheetBytes = files["xl/worksheets/sheet1.xml"];
  if (!sheetBytes)
    throw new ExtractError(`${file.name} has no first sheet to read.`);

  const unescape = (text: string) =>
    text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");

  const shared: string[] = [];
  const sharedBytes = files["xl/sharedStrings.xml"];
  if (sharedBytes) {
    const xml = strFromU8(sharedBytes);
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      // One <si> can hold several <t> runs; they are one string.
      const runs = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [];
      shared.push(
        unescape(runs.map((t) => t.replace(/<[^>]+>/g, "")).join("")),
      );
    }
  }

  const sheet = strFromU8(sheetBytes);
  const grid: string[][] = [];
  for (const rowXml of sheet.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
    const cells: string[] = [];
    for (const cellXml of rowXml.match(/<c[^>]*\/>|<c[^>]*>[\s\S]*?<\/c>/g) ??
      []) {
      // The column letter in r="B7" says where the cell sits, so a sparse
      // row does not shift everything after a gap one place left.
      // Both quote styles: Excel writes double, other writers single.
      const at = cellXml.match(/\sr=["']([A-Z]+)/)?.[1];
      if (at) {
        let index = 0;
        for (const ch of at) index = index * 26 + (ch.charCodeAt(0) - 64);
        while (cells.length < index - 1) cells.push("");
      }
      const type = cellXml.match(/\st=["']([^"']+)["']/)?.[1];
      const raw = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (type === "inlineStr") {
        const inline = cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
        cells.push(unescape(inline.replace(/<[^>]+>/g, "")));
      } else if (type === "s" && raw !== undefined) {
        cells.push(shared[Number(raw)] ?? "");
      } else {
        cells.push(raw === undefined ? "" : unescape(raw));
      }
    }
    grid.push(cells);
  }
  if (grid.length === 0)
    throw new ExtractError(`${file.name} has no rows on its first sheet.`);
  return grid;
}

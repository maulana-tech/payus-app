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

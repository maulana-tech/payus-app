import "server-only";
import { parseHTML } from "linkedom";
import { type Block, type Parse, toBlocks } from "@/features/storefront/blocks";

// Reading a shop page into blocks, on the server.
//
// `toBlocks` is the one reader of this field and it needs a DOM; the canvas
// gives it the browser's, and the Builder has to give it one too. The
// alternative was a second, server-shaped parser for the same markup — and
// a second parser is a second answer to "what is on this page", which is
// the drift the single HTML field exists to prevent. So the parser is
// injected and the reader stays one function with one set of tests.

// linkedom wants a whole document: handed `<body>…</body>` on its own it
// returns an empty body and the page reads as nothing at all. The browser's
// DOMParser is forgiving about this and linkedom is not, which is the kind
// of difference that only shows up in the runtime you tested least — so the
// wrapper is here, next to the parser that needs it.
const parse: Parse = (html) =>
  parseHTML(`<!doctype html><html>${html}</html>`)
    .document as unknown as ReturnType<Parse>;

export const readPage = (html: string): Block[] => toBlocks(html, parse);

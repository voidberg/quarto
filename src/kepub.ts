import { kepubifyXhtml } from "./html.js";
import { decodeUtf8, encodeUtf8 } from "./util.js";
import { unzipEpub, zipEpub } from "./zip.js";

const XHTML_RE = /\.x?html?$/i;
const NAV_RE = /epub:type=["']toc["']/;

/**
 * Convert a standard EPUB into a Kobo kepub in memory — the equivalent of
 * running `kepubify`, with no external binary required.
 *
 * Every content document is rewritten with Kobo reading-location spans and the
 * `book-columns`/`book-inner` wrappers. The navigation document is left
 * untouched. The returned bytes should be written with a `.kepub.epub`
 * extension so Kobo devices recognise the enhanced format.
 */
export function toKepub(epub: Uint8Array): Uint8Array {
  const entries = unzipEpub(epub);
  const files: Record<string, Uint8Array> = {};

  for (const [path, bytes] of Object.entries(entries)) {
    if (path === "mimetype") continue; // re-added (stored, first) by zipEpub
    if (XHTML_RE.test(path)) {
      const html = decodeUtf8(bytes);
      // Skip the navigation document; Kobo builds its TOC from it directly.
      files[path] = NAV_RE.test(html) ? bytes : encodeUtf8(kepubifyXhtml(html));
    } else {
      files[path] = bytes;
    }
  }

  return zipEpub(files);
}

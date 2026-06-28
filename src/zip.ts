import { type Unzipped, unzipSync, type Zippable, zipSync } from "fflate";
import { encodeUtf8 } from "./util.js";

/**
 * Build an EPUB zip. The OCF spec requires the first entry to be an uncompressed
 * `mimetype` file containing exactly `application/epub+zip`; everything else is
 * deflated normally.
 */
export function zipEpub(files: Record<string, Uint8Array>): Uint8Array {
  const zippable: Zippable = {
    // Stored (level 0), and first by virtue of insertion order.
    mimetype: [encodeUtf8("application/epub+zip"), { level: 0 }],
  };

  for (const [path, data] of Object.entries(files)) {
    zippable[path] = data;
  }

  return zipSync(zippable, { level: 6 });
}

/** Unzip an EPUB into a path → bytes map. */
export function unzipEpub(epub: Uint8Array): Unzipped {
  return unzipSync(epub);
}

import type { ImageTransform } from "./types.js";
import { extFromMime, isCoreImageType, mimeFromUrl, sniffImageMime } from "./util.js";

export interface EmbeddedImage {
  /** Path inside the EPUB, e.g. `images/img-1.jpg`. */
  path: string;
  /** Manifest id. */
  id: string;
  mime: string;
  data: Uint8Array;
}

/** Fetch a single image URL (or accept raw bytes) and classify its type. */
export async function fetchImage(
  source: string | Uint8Array,
  fetcher: typeof fetch,
): Promise<{ data: Uint8Array; mime: string }> {
  if (typeof source !== "string") {
    return { data: source, mime: sniffImageMime(source) ?? "image/jpeg" };
  }

  const res = await fetcher(source);
  if (!res.ok) throw new Error(`Failed to fetch image ${source}: HTTP ${res.status}`);

  const data = new Uint8Array(await res.arrayBuffer());
  const headerMime = res.headers.get("content-type")?.split(";")[0]?.trim();
  const mime =
    sniffImageMime(data) ||
    (headerMime?.startsWith("image/") ? headerMime : undefined) ||
    mimeFromUrl(source) ||
    "image/jpeg";

  return { data, mime };
}

/**
 * Download a set of image sources concurrently, skipping any that fail, return
 * no bytes, or aren't an EPUB core image type (the book stays valid even when a
 * source 404s or is unsupported). Returns the embedded images plus a map from
 * original URL → in-package path for rewriting.
 */
export async function embedImages(
  urls: string[],
  fetcher: typeof fetch,
  transform?: ImageTransform,
): Promise<{ images: EmbeddedImage[]; rewrites: Map<string, string> }> {
  const unique = [...new Set(urls)].filter((u) => u.length > 0);
  const images: EmbeddedImage[] = [];
  const rewrites = new Map<string, string>();

  const results = await Promise.allSettled(
    unique.map(async (url) => {
      const img = await fetchImage(url, fetcher);
      return transform ? await transform(img) : img;
    }),
  );

  let counter = 0;
  results.forEach((result, i) => {
    const url = unique[i]!;
    // Skip anything we can't embed: failed fetches, transform-dropped (null) or
    // empty payloads, and types EPUB can't carry without a fallback — the
    // corresponding <img> is then stripped so the EPUB stays valid.
    if (result.status !== "fulfilled" || result.value === null) return;
    if (result.value.data.length === 0 || !isCoreImageType(result.value.mime)) return;
    counter++;
    const ext = extFromMime(result.value.mime);
    const path = `images/img-${counter}.${ext}`;
    const id = `img-${counter}`;
    images.push({ path, id, mime: result.value.mime, data: result.value.data });
    rewrites.set(url, path);
  });

  return { images, rewrites };
}

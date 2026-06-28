import { unzipSync } from "fflate";

const decoder = new TextDecoder();

/** Unzip an EPUB into a path → text map for assertions. */
export function unzipToText(epub: Uint8Array): Record<string, string> {
  const entries = unzipSync(epub);
  const out: Record<string, string> = {};

  for (const [path, bytes] of Object.entries(entries)) {
    out[path] = decoder.decode(bytes);
  }

  return out;
}

/** Minimal valid PNG signature + IHDR-ish bytes (enough for type sniffing). */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

/** A minimal PNG whose IHDR carries the given dimensions (enough for sniff + sizing). */
export function pngBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
  b.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR length (13)
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  b[16] = (width >>> 24) & 0xff;
  b[17] = (width >>> 16) & 0xff;
  b[18] = (width >>> 8) & 0xff;
  b[19] = width & 0xff;
  b[20] = (height >>> 24) & 0xff;
  b[21] = (height >>> 16) & 0xff;
  b[22] = (height >>> 8) & 0xff;
  b[23] = height & 0xff;
  return b;
}

/** A fetch stand-in returning a PNG of the given dimensions. */
export function sizedPngFetch(width: number, height: number): typeof fetch {
  return (async () =>
    new Response(pngBytes(width, height), {
      status: 200,
      headers: { "content-type": "image/png" },
    })) as unknown as typeof fetch;
}

/** A fetch stand-in that returns the same PNG for every request. */
export function pngFetch(): typeof fetch {
  return (async () =>
    new Response(PNG_BYTES, {
      status: 200,
      headers: { "content-type": "image/png" },
    })) as unknown as typeof fetch;
}

/** A fetch stand-in that always fails (404). */
export function failingFetch(): typeof fetch {
  return (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
}

/** A fetch stand-in returning bytes with an arbitrary (non-core) content-type. */
export function typedFetch(contentType: string): typeof fetch {
  return (async () =>
    new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]), {
      status: 200,
      headers: { "content-type": contentType },
    })) as unknown as typeof fetch;
}

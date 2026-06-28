/** Escape a string for use in XML text / attribute content. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const TEXT_ENCODER = new TextEncoder();

export function encodeUtf8(value: string): Uint8Array {
  return TEXT_ENCODER.encode(value);
}

const TEXT_DECODER = new TextDecoder();

export function decodeUtf8(bytes: Uint8Array): string {
  return TEXT_DECODER.decode(bytes);
}

/**
 * Derive a stable `urn:uuid:` from arbitrary seed text using a FNV-1a based
 * hash. Deterministic by design — repeated builds of the same book produce the
 * same identifier, and we avoid `Math.random()`/`Date` so the library stays
 * runtime-agnostic and reproducible.
 */
export function deterministicUuid(seed: string): string {
  // Produce 16 bytes by hashing the seed with several different offsets.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    let hash = 0x811c9dc5 ^ (i * 0x01000193);
    for (let j = 0; j < seed.length; j++) {
      hash ^= seed.charCodeAt(j) + i;
      hash = Math.imul(hash, 0x01000193);
    }
    bytes[i] = (hash >>> 16) & 0xff;
  }
  // Set RFC-4122 version (4) and variant bits so it is a well-formed UUID.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `urn:uuid:${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

export function mimeFromUrl(url: string): string | undefined {
  const clean = url.split("?")[0]?.split("#")[0] ?? "";
  const ext = clean.split(".").pop()?.toLowerCase();
  return ext ? MIME_BY_EXT[ext] : undefined;
}

export function extFromMime(mime: string): string {
  return EXT_BY_MIME[mime.split(";")[0]!.trim().toLowerCase()] ?? "img";
}

/**
 * EPUB 3.3 "core media types" for images. Anything outside this set needs a
 * manifest fallback to be valid, so quarto only embeds these and drops the rest
 * (it does no image transcoding).
 */
const CORE_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);

export function isCoreImageType(mime: string): boolean {
  return CORE_IMAGE_TYPES.has(mime.split(";")[0]!.trim().toLowerCase());
}

/**
 * Read an image's pixel dimensions from its header, without decoding it.
 * Supports PNG, GIF and JPEG (the types quarto embeds as covers); returns
 * `undefined` for anything else or malformed data.
 */
export function imageSize(
  bytes: Uint8Array,
  mime: string,
): { width: number; height: number } | undefined {
  switch (mime.split(";")[0]!.trim().toLowerCase()) {
    case "image/png":
      return pngSize(bytes);
    case "image/gif":
      return gifSize(bytes);
    case "image/jpeg":
      return jpegSize(bytes);
    default:
      return undefined;
  }
}

function u16be(b: Uint8Array, o: number): number {
  return (b[o]! << 8) | b[o + 1]!;
}

function u32be(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

function pngSize(b: Uint8Array): { width: number; height: number } | undefined {
  // 8-byte signature + IHDR length(4) + "IHDR"(4); width@16, height@20 (big-endian).
  if (b.length < 24) return undefined;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function gifSize(b: Uint8Array): { width: number; height: number } | undefined {
  // Logical screen descriptor: width@6, height@8 (little-endian).
  if (b.length < 10) return undefined;
  return { width: b[6]! | (b[7]! << 8), height: b[8]! | (b[9]! << 8) };
}

function jpegSize(b: Uint8Array): { width: number; height: number } | undefined {
  let o = 2; // skip SOI (0xFFD8)
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) {
      o++;
      continue;
    }
    const marker = b[o + 1]!;
    // Start-of-frame markers carry the dimensions (excluding DHT/JPG/DAC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, o + 5), width: u16be(b, o + 7) };
    }
    const len = u16be(b, o + 2);
    if (len < 2) return undefined;
    o += 2 + len;
  }
  return undefined;
}

/** Detect an image MIME type from its leading magic bytes. */
export function sniffImageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length < 4) return undefined;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  return undefined;
}

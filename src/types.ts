/** A single chapter (content document) in the EPUB. */
export interface Chapter {
  /** Chapter title. Used in the navigation/TOC and as the page heading. */
  title: string;

  /**
   * Chapter body as an HTML fragment. It does not need to be well-formed XML —
   * it is parsed and re-serialized as valid XHTML for you.
   */
  html: string;

  /**
   * When `true`, the chapter is included in the reading order (spine) but kept
   * out of the navigation document and NCX. Useful for single-article books
   * where a TOC entry would be redundant.
   */
  excludeFromToc?: boolean;

  /**
   * Optional author for this specific chapter, shown under the title.
   */
  author?: string;

  /**
   * Set to `false` to omit the auto-generated `<h1>` title heading and render
   * only your HTML. Defaults to `true`.
   */
  insertTitle?: boolean;
}

/** An image to embed, either fetched from a URL or provided as raw bytes. */
export type ImageSource = string | Uint8Array;

/** Raw image bytes plus MIME type, as seen by an {@link ImageTransform}. */
export interface RawImage {
  data: Uint8Array;
  mime: string;
}

/**
 * Transform a fetched image before it is embedded. Return replacement
 * bytes + MIME, or `null` to drop the image. May be async.
 */
export type ImageTransform = (image: RawImage) => RawImage | null | Promise<RawImage | null>;

/**
 * Build the final cover. Receives the resolved cover image (downloaded and
 * passed through {@link ImageTransform}, or `null` when the book has no cover
 * source) plus the book's metadata, and returns the bytes to embed — e.g. to
 * compose a designed cover with the title. Return `null` for no cover. May be async.
 */
export type CoverTransform = (
  cover: RawImage | null,
  meta: { title: string; author?: string },
) => RawImage | null | Promise<RawImage | null>;

export interface EpubOptions {
  /** Book title. */
  title: string;

  /** Book author(s). A single string or a list. */
  author?: string | string[];

  /** Publisher metadata. */
  publisher?: string;

  /** Free-text description / synopsis. */
  description?: string;

  /** BCP-47 language tag. Defaults to `"en"`. */
  language?: string;

  /**
   * Unique identifier for the book. If omitted, a deterministic `urn:uuid:` is
   * derived from the title + author so repeated builds are stable.
   */
  id?: string;

  /**
   * Cover image. A URL (downloaded) or raw bytes. When provided, a dedicated
   * cover page is generated.
   */
  cover?: ImageSource;

  /**
   * When no `cover` is given, use the first chapter's *leading* image (one that
   * appears before any text) as the cover, removing it from the body so it isn't
   * shown twice. Images that follow text are left untouched. Defaults to `false`.
   */
  coverFromLeadImage?: boolean;

  /**
   * Whether to emit a navigation document / TOC. When `false`, no nav page is
   * generated and chapters are not listed — the differentiator this library
   * exists for. Defaults to `true`.
   */
  includeToc?: boolean;

  /**
   * Title shown on the table-of-contents page. Defaults to `"Table of Contents"`.
   */
  tocTitle?: string;

  /**
   * CSS colour used to fill the letterbox bands around the cover on the cover
   * page (when the cover image's aspect doesn't match the device page). Set it to
   * the cover's edge/background colour so the bands blend in. Defaults to the
   * reader's page background.
   */
  coverBackground?: string;

  /**
   * Override the bundled stylesheet. Pass a CSS string, or `false` to ship no
   * stylesheet at all.
   */
  css?: string | false;

  /**
   * Fetch and embed `<img>` sources (and the cover) into the package so the EPUB
   * is self-contained. Defaults to `true`.
   *
   * When `false`, nothing is fetched and any non-`data:` `<img>` (remote URLs and
   * relative paths) is dropped — only inline `data:` images survive, keeping the
   * output valid. To embed already-fetched bytes without hitting the network,
   * keep this `true` and pass a custom {@link EpubOptions.fetch}.
   */
  downloadImages?: boolean;

  /**
   * Publication date as an ISO-8601 string (e.g. `"2026-06-25T00:00:00Z"`).
   * Injected for you when running on a normal runtime; pass explicitly for
   * reproducible builds.
   */
  date?: string;

  /**
   * Collection/series this book belongs to. Emitted as both EPUB3
   * `belongs-to-collection` metadata and the legacy Calibre `calibre:series`
   * pair, so readers and device mods (e.g. NickelSeries on Kobo) can group books
   * by series.
   */
  series?: string;

  /**
   * Position within {@link EpubOptions.series} (e.g. `3`). Ignored when no series
   * is set.
   */
  seriesIndex?: number;

  /** Custom fetch implementation (defaults to the global `fetch`). */
  fetch?: typeof fetch;

  /**
   * Hook to transform each fetched image (and the cover) before it is embedded —
   * e.g. to transcode a format the target device can't render, or to resize.
   * Runs after download and before the core-media-type check, so it can also
   * rescue an otherwise-unsupported type by converting it. Return replacement
   * bytes + MIME, or `null` to drop the image. Defaults to leaving images as-is.
   */
  transformImage?: ImageTransform;

  /**
   * Build the final cover before embedding (after the source image is downloaded
   * and transcoded). Called even when there is no cover source, so it can compose
   * a cover from metadata alone. See {@link CoverTransform}.
   */
  transformCover?: CoverTransform;
}

/** Input passed to {@link generateEpub}. */
export interface EpubInput extends EpubOptions {
  chapters: Chapter[];
}

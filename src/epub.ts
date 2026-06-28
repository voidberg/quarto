import { DEFAULT_CSS } from "./css.js";
import { HtmlFragment } from "./html.js";
import { embedImages, fetchImage } from "./images.js";
import {
  buildNav,
  buildNcx,
  buildOpf,
  buildSvgCover,
  buildXhtml,
  CONTAINER_XML,
  type ManifestItem,
  type NavEntry,
  type Reference,
} from "./opf.js";
import type {
  Chapter,
  CoverTransform,
  EpubInput,
  ImageSource,
  ImageTransform,
  RawImage,
} from "./types.js";
import {
  deterministicUuid,
  encodeUtf8,
  escapeXml,
  extFromMime,
  imageSize,
  isCoreImageType,
} from "./util.js";
import { zipEpub } from "./zip.js";

/** Mutable accumulators shared by the build phases. */
interface BuildContext {
  files: Record<string, Uint8Array>;
  manifest: ManifestItem[];
  spine: string[];
}

/** Options with every default resolved once, up front. */
interface ResolvedOptions {
  language: string;
  includeToc: boolean;
  downloadImages: boolean;
  tocTitle: string;
  fetcher: typeof fetch;
  coverFromLeadImage: boolean;
  coverBackground?: string;
  transformImage?: ImageTransform;
  transformCover?: CoverTransform;
  /** Stylesheet contents, or `undefined` when disabled. */
  css?: string;
  /** Chapter-relative href to the stylesheet, or `undefined` when disabled. */
  cssHref?: string;
}

/**
 * Generate a complete, valid EPUB3 publication in memory from HTML chapters.
 *
 * The returned bytes are a ready-to-write `.epub`. Pass the result to
 * {@link toKepub} to produce a Kobo-optimised `.kepub.epub`.
 */
export async function generateEpub(input: EpubInput): Promise<Uint8Array> {
  if (!input.chapters?.length) {
    throw new Error("generateEpub: at least one chapter is required.");
  }

  const opts = resolveOptions(input);
  const authors = normalizeAuthors(input.author);
  const id = input.id ?? deterministicUuid(`${input.title} ${authors.join(",")}`);

  const ctx: BuildContext = { files: {}, manifest: [], spine: [] };
  ctx.files["META-INF/container.xml"] = encodeUtf8(CONTAINER_XML);

  addStylesheet(ctx, opts.css);

  const fragments = input.chapters.map((ch) => HtmlFragment.parse(ch.html));
  // No explicit cover? Optionally promote the first chapter's lead image.
  const coverSource =
    input.cover ?? (opts.coverFromLeadImage ? fragments[0]!.extractLeadImage() : undefined);
  const cover = await addCover(ctx, coverSource, input.title, authors, opts);

  await embedChapterImages(ctx, fragments, opts);

  const navEntries = addChapters(ctx, input.chapters, fragments, opts);
  const ncxId = addNavigation(
    ctx,
    input.chapters,
    navEntries,
    opts,
    cover.hasCoverPage,
    id,
    input.title,
  );

  // EPUB2 guide (cover + reading start) for readers that rely on it.
  const guide: Reference[] = [];
  if (cover.hasCoverPage) guide.push({ type: "cover", href: "text/cover.xhtml", title: "Cover" });
  guide.push({ type: "text", href: "text/chapter-1.xhtml", title: "Start" });

  ctx.files["EPUB/content.opf"] = encodeUtf8(
    buildOpf(
      {
        id,
        title: input.title,
        authors,
        language: opts.language,
        publisher: input.publisher,
        description: input.description,
        date: input.date,
        coverImageId: cover.coverImageId,
      },
      ctx.manifest,
      ctx.spine,
      { ncxId, guide },
    ),
  );

  return zipEpub(ctx.files);
}

function resolveOptions(input: EpubInput): ResolvedOptions {
  const css = input.css === false ? undefined : (input.css ?? DEFAULT_CSS);

  return {
    language: input.language ?? "en",
    includeToc: input.includeToc ?? true,
    downloadImages: input.downloadImages ?? true,
    tocTitle: input.tocTitle ?? "Table of Contents",
    fetcher: input.fetch ?? globalThis.fetch,
    coverFromLeadImage: input.coverFromLeadImage ?? false,
    coverBackground: input.coverBackground,
    transformImage: input.transformImage,
    transformCover: input.transformCover,
    css,
    cssHref: css ? "../style.css" : undefined,
  };
}

/** Write the stylesheet (when enabled) and register it in the manifest. */
function addStylesheet(ctx: BuildContext, css: string | undefined): void {
  if (!css) return;

  ctx.files["EPUB/style.css"] = encodeUtf8(css);
  ctx.manifest.push({ id: "css", href: "style.css", mediaType: "text/css" });
}

/**
 * Resolve and embed the cover. The source image (if any) is downloaded and run
 * through {@link ResolvedOptions.transformImage}; then {@link ResolvedOptions.transformCover}
 * gets the final say (even with no source image, so it can compose one from
 * metadata). The result is embedded as the cover image + a dedicated cover page
 * (SVG-wrapped for reliable scaling) at the front of the spine. Any failure is
 * swallowed — a missing cover must never abort the build.
 */
async function addCover(
  ctx: BuildContext,
  coverSource: ImageSource | undefined,
  title: string,
  authors: string[],
  opts: ResolvedOptions,
): Promise<{ coverImageId?: string; hasCoverPage: boolean }> {
  // 1. Download + transcode the source image, if there is one.
  let img: RawImage | null = null;
  if (coverSource) {
    try {
      const fetched = await fetchImage(coverSource, opts.fetcher);
      const transformed = opts.transformImage ? await opts.transformImage(fetched) : fetched;
      // Only keep a cover whose type EPUB can carry without a fallback.
      if (transformed && isCoreImageType(transformed.mime)) img = transformed;
    } catch {
      // Leave img null; transformCover may still compose one.
    }
  }

  // 2. Let the caller shape the final cover (compose with title, normalise, …).
  if (opts.transformCover) {
    try {
      img = await opts.transformCover(img, { title, author: authors[0] });
    } catch {
      // Fall back to the un-composed image (or none) rather than aborting.
    }
  }

  if (!img) return { hasCoverPage: false };

  // 3. Embed the cover image + cover page.
  const coverPath = `images/cover.${extFromMime(img.mime)}`;
  ctx.files[`EPUB/${coverPath}`] = img.data;
  ctx.manifest.push({
    id: "cover-image",
    href: coverPath,
    mediaType: img.mime,
    properties: "cover-image",
  });

  // Prefer an SVG-wrapped cover (fills + centers reliably on e-readers); fall
  // back to a plain <img> only when we can't read the image's dimensions.
  const coverHref = `../${coverPath}`;
  const dims = imageSize(img.data, img.mime);
  if (dims) {
    ctx.files["EPUB/text/cover.xhtml"] = encodeUtf8(
      buildSvgCover({
        title,
        language: opts.language,
        imageHref: coverHref,
        width: dims.width,
        height: dims.height,
        background: opts.coverBackground,
      }),
    );
    ctx.manifest.push({
      id: "cover-page",
      href: "text/cover.xhtml",
      mediaType: "application/xhtml+xml",
      properties: "svg",
    });
  } else {
    const coverBody = `    <div class="quarto-cover" epub:type="cover">\n      <img src="${coverHref}" alt="${escapeXml(
      title,
    )}"/>\n    </div>`;
    ctx.files["EPUB/text/cover.xhtml"] = encodeUtf8(
      buildXhtml({ title, language: opts.language, cssHref: opts.cssHref, bodyHtml: coverBody }),
    );
    ctx.manifest.push({
      id: "cover-page",
      href: "text/cover.xhtml",
      mediaType: "application/xhtml+xml",
    });
  }
  ctx.spine.push("cover-page");

  return { coverImageId: "cover-image", hasCoverPage: true };
}

/**
 * Resolve the images referenced by the chapter fragments. When downloading,
 * fetch and embed them (rewriting each `<img>` to its in-package path); when not,
 * drop external references so only self-contained `data:` images survive.
 */
async function embedChapterImages(
  ctx: BuildContext,
  fragments: HtmlFragment[],
  opts: ResolvedOptions,
): Promise<void> {
  if (!opts.downloadImages) {
    for (const f of fragments) f.stripExternalImages();
    return;
  }

  const allUrls = fragments.flatMap((f) => f.imageSources());
  const { images, rewrites } = await embedImages(allUrls, opts.fetcher, opts.transformImage);

  // Chapter files live in EPUB/text/, images in EPUB/images/.
  const chapterRewrites = new Map<string, string>();
  for (const [url, path] of rewrites) chapterRewrites.set(url, `../${path}`);
  for (const f of fragments) f.resolveImages(chapterRewrites, true);

  for (const img of images) {
    ctx.files[`EPUB/${img.path}`] = img.data;
    ctx.manifest.push({ id: img.id, href: img.path, mediaType: img.mime });
  }
}

/** Write one XHTML document per chapter; return the TOC entries to surface. */
function addChapters(
  ctx: BuildContext,
  chapters: Chapter[],
  fragments: HtmlFragment[],
  opts: ResolvedOptions,
): NavEntry[] {
  const navEntries: NavEntry[] = [];

  chapters.forEach((chapter, i) => {
    const fileId = `chapter-${i + 1}`;
    const href = `text/${fileId}.xhtml`;
    const heading = chapter.insertTitle === false ? "" : titleBlock(chapter.title, chapter.author);
    const bodyHtml = `${heading}${fragments[i]!.serialize()}`;

    ctx.files[`EPUB/${href}`] = encodeUtf8(
      buildXhtml({
        title: chapter.title,
        language: opts.language,
        cssHref: opts.cssHref,
        bodyHtml: `    ${bodyHtml}`,
      }),
    );
    ctx.manifest.push({ id: fileId, href, mediaType: "application/xhtml+xml" });
    ctx.spine.push(fileId);

    if (!chapter.excludeFromToc) navEntries.push({ href, title: chapter.title });
  });

  return navEntries;
}

/**
 * Emit the navigation document (always — EPUB3 requires one) plus, for a visible
 * TOC, the spine entry and NCX. Returns the NCX id, or `undefined` when hidden.
 */
function addNavigation(
  ctx: BuildContext,
  chapters: Chapter[],
  navEntries: NavEntry[],
  opts: ResolvedOptions,
  hasCoverPage: boolean,
  id: string,
  title: string,
): string | undefined {
  // A visible TOC requires includeToc AND at least one non-excluded chapter.
  const showToc = opts.includeToc && navEntries.length > 0;
  // The nav doc must reference content even when hidden, so fall back to all chapters.
  const navList: NavEntry[] = navEntries.length
    ? navEntries
    : chapters.map((ch, i) => ({ href: `text/chapter-${i + 1}.xhtml`, title: ch.title }));

  // Landmarks let readers jump to the cover / reading start.
  const landmarks: Reference[] = [];
  if (hasCoverPage) landmarks.push({ type: "cover", href: "text/cover.xhtml", title: "Cover" });
  landmarks.push({ type: "bodymatter", href: "text/chapter-1.xhtml", title: "Start" });
  if (showToc) landmarks.push({ type: "toc", href: "nav.xhtml", title: opts.tocTitle });

  ctx.files["EPUB/nav.xhtml"] = encodeUtf8(
    buildNav(opts.tocTitle, opts.language, navList, !showToc, landmarks),
  );
  ctx.manifest.push({
    id: "nav",
    href: "nav.xhtml",
    mediaType: "application/xhtml+xml",
    properties: "nav",
  });

  if (!showToc) return undefined;

  // Reading order: cover (if any) → TOC page → chapters.
  ctx.spine.splice(hasCoverPage ? 1 : 0, 0, "nav");
  ctx.files["EPUB/toc.ncx"] = encodeUtf8(buildNcx(id, title, navList));
  ctx.manifest.push({ id: "ncx", href: "toc.ncx", mediaType: "application/x-dtbncx+xml" });

  return "ncx";
}

function normalizeAuthors(author?: string | string[]): string[] {
  if (!author) return [];

  return (Array.isArray(author) ? author : [author]).filter((a) => a.trim().length > 0);
}

function titleBlock(title: string, author?: string): string {
  const authorLine = author ? `\n    <p class="quarto-author">${escapeXml(author)}</p>` : "";

  return `<h1 class="quarto-title">${escapeXml(title)}</h1>${authorLine}\n    `;
}

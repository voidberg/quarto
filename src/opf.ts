import { escapeXml } from "./util.js";

export interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  /** EPUB3 manifest properties, e.g. `"nav"` or `"cover-image"`. */
  properties?: string;
}

export interface NavEntry {
  href: string;
  title: string;
}

/** A reference for the EPUB2 `<guide>` or the EPUB3 landmarks nav (e.g. cover, start). */
export interface Reference {
  type: string;
  href: string;
  title: string;
}

export interface OpfMetadata {
  id: string;
  title: string;
  authors: string[];
  language: string;
  publisher?: string;
  description?: string;
  date?: string;
  coverImageId?: string;
  /** Collection/series name this book belongs to. */
  series?: string;
  /** Position within the series. */
  seriesIndex?: number;
}

export const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

/** A fixed timestamp keeps builds reproducible when no date is supplied. */
const EPOCH = "1970-01-01T00:00:00Z";

/**
 * EPUB3 requires `dcterms:modified` to be exactly `CCYY-MM-DDThh:mm:ssZ` — UTC,
 * no fractional seconds. Normalize whatever the caller passed (commonly a full
 * `Date.toISOString()` with milliseconds) into that form, falling back to
 * {@link EPOCH} when it isn't a parseable date.
 */
function normalizeModified(date?: string): string {
  if (!date) return EPOCH;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return EPOCH;
  return `${new Date(t).toISOString().slice(0, 19)}Z`;
}

export function buildOpf(
  meta: OpfMetadata,
  manifest: ManifestItem[],
  spine: string[],
  options: { ncxId?: string; guide?: Reference[] } = {},
): string {
  const modified = normalizeModified(meta.date);

  const metaTags: string[] = [
    `<dc:identifier id="pub-id">${escapeXml(meta.id)}</dc:identifier>`,
    `<dc:title>${escapeXml(meta.title)}</dc:title>`,
    `<dc:language>${escapeXml(meta.language)}</dc:language>`,
    `<meta property="dcterms:modified">${modified}</meta>`,
  ];

  for (const author of meta.authors) {
    metaTags.push(`<dc:creator>${escapeXml(author)}</dc:creator>`);
  }

  if (meta.publisher) metaTags.push(`<dc:publisher>${escapeXml(meta.publisher)}</dc:publisher>`);
  if (meta.description)
    metaTags.push(`<dc:description>${escapeXml(meta.description)}</dc:description>`);
  if (meta.date) metaTags.push(`<dc:date>${escapeXml(meta.date)}</dc:date>`);
  if (meta.coverImageId)
    metaTags.push(`<meta name="cover" content="${escapeXml(meta.coverImageId)}"/>`);

  if (meta.series) {
    // Emit both forms: the EPUB3 `belongs-to-collection` metadata and the legacy
    // Calibre `meta name` pair. Different tools read different ones - NickelSeries
    // and Calibre prefer the Calibre form, EPUB-native readers the former.
    const series = escapeXml(meta.series);
    metaTags.push(`<meta property="belongs-to-collection" id="series">${series}</meta>`);
    metaTags.push(`<meta refines="#series" property="collection-type">series</meta>`);
    metaTags.push(`<meta name="calibre:series" content="${series}"/>`);
    if (meta.seriesIndex !== undefined) {
      const index = escapeXml(String(meta.seriesIndex));
      metaTags.push(`<meta refines="#series" property="group-position">${index}</meta>`);
      metaTags.push(`<meta name="calibre:series_index" content="${index}"/>`);
    }
  }

  const manifestTags = manifest.map((item) => {
    const props = item.properties ? ` properties="${item.properties}"` : "";
    return `<item id="${escapeXml(item.id)}" href="${escapeXml(item.href)}" media-type="${item.mediaType}"${props}/>`;
  });

  const spineTags = spine.map((idref) => `<itemref idref="${escapeXml(idref)}"/>`);
  const spineToc = options.ncxId ? ` toc="${escapeXml(options.ncxId)}"` : "";

  // EPUB2 guide — deprecated in EPUB3 but still used by Kindle/older readers to
  // locate the cover and reading start.
  const guideBlock = options.guide?.length
    ? `\n  <guide>\n    ${options.guide
        .map(
          (r) =>
            `<reference type="${escapeXml(r.type)}" title="${escapeXml(r.title)}" href="${escapeXml(r.href)}"/>`,
        )
        .join("\n    ")}\n  </guide>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${escapeXml(meta.language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${metaTags.join("\n    ")}
  </metadata>
  <manifest>
    ${manifestTags.join("\n    ")}
  </manifest>
  <spine${spineToc}>
    ${spineTags.join("\n    ")}
  </spine>${guideBlock}
</package>
`;
}

/**
 * EPUB3 navigation document. EPUB3 mandates exactly one `nav` document, so even
 * when a book opts out of a table of contents we still emit one — but mark it
 * `hidden` and keep it out of the spine so no visible TOC page appears.
 */
export function buildNav(
  navTitle: string,
  language: string,
  entries: NavEntry[],
  hidden = false,
  landmarks: Reference[] = [],
): string {
  const items = entries
    .map((e) => `        <li><a href="${escapeXml(e.href)}">${escapeXml(e.title)}</a></li>`)
    .join("\n");
  const hiddenAttr = hidden ? ` hidden=""` : "";
  const heading = hidden ? "" : `\n      <h1>${escapeXml(navTitle)}</h1>`;

  // EPUB3 landmarks nav — lets readers jump to the cover / reading start. Hidden,
  // it's a navigation aid, not a visible page.
  const landmarksNav = landmarks.length
    ? `\n    <nav epub:type="landmarks" hidden="">\n      <ol>\n${landmarks
        .map(
          (l) =>
            `        <li><a epub:type="${escapeXml(l.type)}" href="${escapeXml(l.href)}">${escapeXml(l.title)}</a></li>`,
        )
        .join("\n")}\n      </ol>\n    </nav>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(language)}" xml:lang="${escapeXml(language)}">
  <head>
    <meta charset="utf-8"/>
    <title>${escapeXml(navTitle)}</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc"${hiddenAttr}>${heading}
      <ol>
${items}
      </ol>
    </nav>${landmarksNav}
  </body>
</html>
`;
}

/** EPUB2 NCX, kept for older e-reader compatibility. */
export function buildNcx(id: string, title: string, entries: NavEntry[]): string {
  const points = entries
    .map(
      (e, i) => `    <navPoint id="nav-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(e.title)}</text></navLabel>
      <content src="${escapeXml(e.href)}"/>
    </navPoint>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(id)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`;
}

export interface SvgCoverOptions {
  title: string;
  language: string;
  imageHref: string;
  width: number;
  height: number;
  /** Fills the letterbox bands around the cover image (e.g. to match its edges). */
  background?: string;
}

/**
 * A cover page that wraps the image in an SVG scaled to fit the viewport
 * (`preserveAspectRatio="xMidYMid meet"`). This is the portable way to make a
 * cover fill and center consistently across readers — inline `<img>` layout
 * anchors awkwardly on e-ink devices like Kobo.
 */
export function buildSvgCover(opts: SvgCoverOptions): string {
  const bg = opts.background ? `;background:${opts.background}` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(opts.language)}" xml:lang="${escapeXml(opts.language)}">
  <head>
    <meta charset="utf-8"/>
    <title>${escapeXml(opts.title)}</title>
    <style>@page{margin:0}html,body{margin:0;padding:0;height:100%;overflow:hidden${bg}}svg{display:block;width:100%;height:100vh${bg}}</style>
  </head>
  <body epub:type="cover">
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="100%" height="100vh" viewBox="0 0 ${opts.width} ${opts.height}" preserveAspectRatio="xMidYMid meet">
      <image width="${opts.width}" height="${opts.height}" xlink:href="${escapeXml(opts.imageHref)}"/>
    </svg>
  </body>
</html>
`;
}

export interface XhtmlPageOptions {
  title: string;
  language: string;
  cssHref?: string;
  bodyHtml: string;
  bodyClass?: string;
}

/** Wrap body HTML in a complete XHTML content document. */
export function buildXhtml(opts: XhtmlPageOptions): string {
  const css = opts.cssHref
    ? `\n    <link rel="stylesheet" type="text/css" href="${escapeXml(opts.cssHref)}"/>`
    : "";
  const bodyClass = opts.bodyClass ? ` class="${escapeXml(opts.bodyClass)}"` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(opts.language)}" xml:lang="${escapeXml(opts.language)}">
  <head>
    <meta charset="utf-8"/>
    <title>${escapeXml(opts.title)}</title>${css}
  </head>
  <body${bodyClass}>
${opts.bodyHtml}
  </body>
</html>
`;
}

import { describe, expect, it } from "vitest";
import { generateEpub } from "../src/index.js";
import {
  failingFetch,
  pngBytes,
  pngFetch,
  sizedPngFetch,
  typedFetch,
  unzipToText,
} from "./helpers.js";

/** Assert the first chapter kept its text but its `<img>` was dropped. */
function expectImageDropped(files: Record<string, string>): void {
  const ch = files["EPUB/text/chapter-1.xhtml"]!;
  expect(ch).toContain("text");
  expect(ch).not.toContain("<img");
}

describe("generateEpub", () => {
  it("produces a valid OCF container with mimetype and opf", async () => {
    const epub = await generateEpub({
      title: "My Book",
      author: "Jane Doe",
      chapters: [{ title: "One", html: "<p>Hello world</p>" }],
    });
    const files = unzipToText(epub);

    expect(files.mimetype).toBe("application/epub+zip");
    expect(files["META-INF/container.xml"]).toContain("EPUB/content.opf");
    expect(files["EPUB/content.opf"]).toContain("<dc:title>My Book</dc:title>");
    expect(files["EPUB/content.opf"]).toContain("<dc:creator>Jane Doe</dc:creator>");
    expect(files["EPUB/text/chapter-1.xhtml"]).toContain("Hello world");
  });

  it("escapes XML-significant characters in metadata", async () => {
    const epub = await generateEpub({
      title: "Tom & Jerry <fun>",
      chapters: [{ title: "C", html: "<p>x</p>" }],
    });
    const opf = unzipToText(epub)["EPUB/content.opf"]!;

    expect(opf).toContain("Tom &amp; Jerry &lt;fun&gt;");
  });

  it("normalizes dcterms:modified to second precision (EPUB3 requires no milliseconds)", async () => {
    const epub = await generateEpub({
      title: "D",
      date: "2026-06-27T13:00:00.000Z",
      chapters: [{ title: "C", html: "<p>x</p>" }],
    });
    const opf = unzipToText(epub)["EPUB/content.opf"]!;

    expect(opf).toContain('<meta property="dcterms:modified">2026-06-27T13:00:00Z</meta>');
    // dc:date is the lenient field and keeps exactly what the caller passed.
    expect(opf).toContain("<dc:date>2026-06-27T13:00:00.000Z</dc:date>");
  });

  it("emits series metadata in both EPUB3 and Calibre forms", async () => {
    const epub = await generateEpub({
      title: "S",
      series: "Engineering",
      seriesIndex: 3,
      chapters: [{ title: "C", html: "<p>x</p>" }],
    });
    const opf = unzipToText(epub)["EPUB/content.opf"]!;

    expect(opf).toContain('<meta property="belongs-to-collection" id="series">Engineering</meta>');
    expect(opf).toContain('<meta refines="#series" property="collection-type">series</meta>');
    expect(opf).toContain('<meta refines="#series" property="group-position">3</meta>');
    expect(opf).toContain('<meta name="calibre:series" content="Engineering"/>');
    expect(opf).toContain('<meta name="calibre:series_index" content="3"/>');
  });

  it("omits the series index metadata when only a series name is given", async () => {
    const epub = await generateEpub({
      title: "S",
      series: "Unfiled",
      chapters: [{ title: "C", html: "<p>x</p>" }],
    });
    const opf = unzipToText(epub)["EPUB/content.opf"]!;

    expect(opf).toContain('<meta property="belongs-to-collection" id="series">Unfiled</meta>');
    expect(opf).not.toContain("group-position");
    expect(opf).not.toContain("calibre:series_index");
  });

  it("re-serializes malformed HTML into well-formed XHTML", async () => {
    const epub = await generateEpub({
      title: "B",
      chapters: [{ title: "C", html: "<p>unclosed<br>next<img src='data:,'>" }],
    });
    const ch = unzipToText(epub)["EPUB/text/chapter-1.xhtml"]!;

    expect(ch).toContain("<br/>");
    expect(ch).toContain("</p>");
  });

  it("rewrites block elements nested in phrasing elements to keep XHTML valid", async () => {
    const epub = await generateEpub({
      title: "B",
      chapters: [{ title: "C", html: '<p>ok</p><span class="x"><div>block in span</div></span>' }],
    });
    const ch = unzipToText(epub)["EPUB/text/chapter-1.xhtml"]!;

    // The offending <span> became a <div> (attributes kept); no span wraps a div.
    expect(ch).toContain('<div class="x"><div>block in span</div></div>');
    expect(ch).not.toContain("<span");
  });

  it("escapes attribute values correctly, preserving regular spaces", async () => {
    const epub = await generateEpub({
      title: "B",
      chapters: [{ title: "C", html: `<p class="foo bar" title='a&quot;b&lt;c d'>x</p>` }],
    });
    const ch = unzipToText(epub)["EPUB/text/chapter-1.xhtml"]!;

    // Multi-token class names keep their spaces (not turned into &#160;).
    expect(ch).toContain('class="foo bar"');
    // Quotes and angle brackets inside attribute values are escaped.
    expect(ch).toContain('title="a&quot;b&lt;c d"');
    expect(ch).not.toContain("&#160;");
  });

  it("emits EPUB3 landmarks and an EPUB2 guide for cover + reading start", async () => {
    const epub = await generateEpub({
      title: "B",
      cover: pngBytes(600, 800),
      chapters: [{ title: "C", html: "<p>a</p>" }],
    });
    const files = unzipToText(epub);

    expect(files["EPUB/nav.xhtml"]).toContain('epub:type="landmarks"');
    expect(files["EPUB/nav.xhtml"]).toContain('epub:type="cover" href="text/cover.xhtml"');
    expect(files["EPUB/content.opf"]).toContain("<guide>");
    expect(files["EPUB/content.opf"]).toContain('<reference type="cover" title="Cover"');
    expect(files["EPUB/content.opf"]).toContain('<reference type="text"');
  });

  describe("table of contents", () => {
    it("includes a visible TOC + NCX by default", async () => {
      const epub = await generateEpub({
        title: "B",
        chapters: [
          { title: "Alpha", html: "<p>a</p>" },
          { title: "Beta", html: "<p>b</p>" },
        ],
      });
      const files = unzipToText(epub);

      expect(files["EPUB/nav.xhtml"]).toContain(">Alpha<");
      expect(files["EPUB/nav.xhtml"]).toContain(">Beta<");
      // The TOC nav itself is visible (the separate landmarks nav is hidden).
      expect(files["EPUB/nav.xhtml"]).toContain('id="toc">');
      expect(files["EPUB/nav.xhtml"]).not.toContain('id="toc" hidden');
      expect(files["EPUB/toc.ncx"]).toBeDefined();
      expect(files["EPUB/content.opf"]).toContain('toc="ncx"');
      expect(files["EPUB/content.opf"]).toContain('<itemref idref="nav"/>');
    });

    it("omits the TOC when includeToc is false but stays valid", async () => {
      const epub = await generateEpub({
        title: "B",
        includeToc: false,
        chapters: [{ title: "Alpha", html: "<p>a</p>" }],
      });
      const files = unzipToText(epub);

      // nav doc still present (EPUB3 requires it) but the TOC nav is hidden and out of spine.
      expect(files["EPUB/nav.xhtml"]).toContain('id="toc" hidden');
      expect(files["EPUB/content.opf"]).toContain('properties="nav"');
      expect(files["EPUB/content.opf"]).not.toContain('toc="ncx"');
      expect(files["EPUB/content.opf"]).not.toContain('<itemref idref="nav"/>');
      expect(files["EPUB/toc.ncx"]).toBeUndefined();
    });

    it("respects excludeFromToc per chapter", async () => {
      const epub = await generateEpub({
        title: "B",
        chapters: [
          { title: "Shown", html: "<p>a</p>" },
          { title: "Hidden", html: "<p>b</p>", excludeFromToc: true },
        ],
      });
      const nav = unzipToText(epub)["EPUB/nav.xhtml"]!;

      expect(nav).toContain(">Shown<");
      expect(nav).not.toContain(">Hidden<");
    });
  });

  describe("images", () => {
    it("downloads and embeds chapter images, rewriting src", async () => {
      const epub = await generateEpub({
        title: "B",
        fetch: pngFetch(),
        chapters: [{ title: "C", html: '<p><img src="https://x/cat.png"></p>' }],
      });
      const files = unzipToText(epub);

      expect(files["EPUB/images/img-1.png"]).toBeDefined();
      expect(files["EPUB/text/chapter-1.xhtml"]).toContain('src="../images/img-1.png"');
      expect(files["EPUB/content.opf"]).toContain('media-type="image/png"');
    });

    it("strips images that fail to download so the EPUB stays valid", async () => {
      const epub = await generateEpub({
        title: "B",
        fetch: failingFetch(),
        chapters: [{ title: "C", html: '<p>text<img src="https://x/cat.png"></p>' }],
      });
      const files = unzipToText(epub);

      // The unresolved <img> is removed; surrounding content survives.
      expectImageDropped(files);
      expect(files["EPUB/images/img-1.png"]).toBeUndefined();
    });

    it("embeds inline base64 data: images", async () => {
      const dataUrl =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMEAYEjQ4dJAAAAAElFTkSuQmCC";
      const epub = await generateEpub({
        title: "B",
        chapters: [{ title: "C", html: `<p><img src="${dataUrl}"></p>` }],
      });
      const files = unzipToText(epub);

      expect(files["EPUB/images/img-1.png"]).toBeDefined();
      expect(files["EPUB/text/chapter-1.xhtml"]).toContain('src="../images/img-1.png"');
    });

    describe("downloadImages: false", () => {
      const dataUrl =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMEAYEjQ4dJAAAAAElFTkSuQmCC";

      it("drops remote and relative <img>, keeping inline data: images", async () => {
        const epub = await generateEpub({
          title: "B",
          downloadImages: false,
          chapters: [
            {
              title: "C",
              html:
                `<p>text <img src="https://x/cat.png"> ` +
                `<img src="//x/dog.png"> <img src="local.png"> ` +
                `<img src="${dataUrl}"></p>`,
            },
          ],
        });
        const ch = unzipToText(epub)["EPUB/text/chapter-1.xhtml"]!;

        expect(ch).toContain("text");
        // External references are removed; nothing is fetched or embedded.
        expect(ch).not.toContain("https://x/cat.png");
        expect(ch).not.toContain("//x/dog.png");
        expect(ch).not.toContain("local.png");
        // The self-contained data: image is kept inline (not extracted to a file).
        expect(ch).toContain('src="data:image/png;base64,');
        expect(unzipToText(epub)["EPUB/images/img-1.png"]).toBeUndefined();
      });
    });

    it("drops images whose type isn't an EPUB core media type", async () => {
      // AVIF is not an EPUB 3.3 core image type; without transcoding it can't be
      // embedded validly, so it must be stripped rather than packaged.
      const epub = await generateEpub({
        title: "B",
        fetch: typedFetch("image/avif"),
        chapters: [{ title: "C", html: '<p>text<img src="https://x/pic.avif"></p>' }],
      });
      const files = unzipToText(epub);

      expectImageDropped(files);
      expect(files["EPUB/content.opf"]).not.toContain("image/avif");
    });

    it("skips a cover whose type isn't an EPUB core media type", async () => {
      const epub = await generateEpub({
        title: "B",
        cover: "https://x/cover.avif",
        fetch: typedFetch("image/avif"),
        chapters: [{ title: "C", html: "<p>a</p>" }],
      });
      const opf = unzipToText(epub)["EPUB/content.opf"]!;

      expect(opf).not.toContain('properties="cover-image"');
      expect(opf).not.toContain("image/avif");
    });

    it("applies transformImage to transcode an unsupported type into a core one", async () => {
      // Simulate transcoding WebP → PNG: swap the MIME (and bytes) in the hook.
      const epub = await generateEpub({
        title: "B",
        fetch: typedFetch("image/webp"),
        transformImage: ({ data }) => ({ data, mime: "image/png" }),
        chapters: [{ title: "C", html: '<p><img src="https://x/pic.webp"></p>' }],
      });
      const files = unzipToText(epub);

      expect(files["EPUB/images/img-1.png"]).toBeDefined();
      expect(files["EPUB/text/chapter-1.xhtml"]).toContain('src="../images/img-1.png"');
      expect(files["EPUB/content.opf"]).toContain('media-type="image/png"');
    });

    it("drops an image when transformImage returns null", async () => {
      const epub = await generateEpub({
        title: "B",
        fetch: pngFetch(),
        transformImage: () => null,
        chapters: [{ title: "C", html: '<p>text<img src="https://x/cat.png"></p>' }],
      });
      const files = unzipToText(epub);

      expectImageDropped(files);
      expect(files["EPUB/images/img-1.png"]).toBeUndefined();
    });

    it("generates a cover page from a cover image", async () => {
      const epub = await generateEpub({
        title: "B",
        cover: "https://x/cover.png",
        fetch: pngFetch(),
        chapters: [{ title: "C", html: "<p>a</p>" }],
      });
      const files = unzipToText(epub);

      expect(files["EPUB/images/cover.png"]).toBeDefined();
      expect(files["EPUB/text/cover.xhtml"]).toContain('epub:type="cover"');
      expect(files["EPUB/content.opf"]).toContain('properties="cover-image"');
      expect(files["EPUB/content.opf"]).toMatch(/<spine[^>]*>\s*<itemref idref="cover-page"/);
    });

    it("uses an SVG-wrapped cover when image dimensions are readable", async () => {
      const epub = await generateEpub({
        title: "B",
        cover: pngBytes(600, 800),
        chapters: [{ title: "C", html: "<p>a</p>" }],
      });
      const files = unzipToText(epub);

      expect(files["EPUB/text/cover.xhtml"]).toContain("<svg");
      expect(files["EPUB/text/cover.xhtml"]).toContain('viewBox="0 0 600 800"');
      expect(files["EPUB/text/cover.xhtml"]).toContain('preserveAspectRatio="xMidYMid meet"');
      expect(files["EPUB/content.opf"]).toContain('properties="svg"');
    });

    it("paints the cover-page letterbox bands when coverBackground is set", async () => {
      const epub = await generateEpub({
        title: "B",
        cover: pngBytes(600, 800),
        coverBackground: "#f4f1ea",
        chapters: [{ title: "C", html: "<p>a</p>" }],
      });
      const cover = unzipToText(epub)["EPUB/text/cover.xhtml"]!;

      expect(cover).toContain("background:#f4f1ea");
    });

    describe("transformCover", () => {
      it("receives the resolved cover image and can replace it", async () => {
        let received: { mime: string; title: string } | undefined;
        const epub = await generateEpub({
          title: "Composed",
          cover: "https://x/cover.png",
          fetch: pngFetch(),
          transformCover: (cover, meta) => {
            received = { mime: cover!.mime, title: meta.title };
            return { data: pngBytes(1200, 1920), mime: "image/png" };
          },
          chapters: [{ title: "C", html: "<p>a</p>" }],
        });
        const files = unzipToText(epub);

        expect(received).toEqual({ mime: "image/png", title: "Composed" });
        // The composed image is embedded; the SVG cover uses its dimensions.
        expect(files["EPUB/text/cover.xhtml"]).toContain('viewBox="0 0 1200 1920"');
      });

      it("is called with null when there is no cover source (compose from metadata)", async () => {
        let arg: unknown = "unset";
        const epub = await generateEpub({
          title: "No Source",
          transformCover: (cover) => {
            arg = cover;
            return { data: pngBytes(400, 600), mime: "image/png" };
          },
          chapters: [{ title: "C", html: "<p>a</p>" }],
        });
        const files = unzipToText(epub);

        expect(arg).toBeNull();
        expect(files["EPUB/images/cover.png"]).toBeDefined();
        expect(files["EPUB/content.opf"]).toContain('properties="cover-image"');
      });

      it("returning null means no cover", async () => {
        const epub = await generateEpub({
          title: "B",
          cover: "https://x/cover.png",
          fetch: pngFetch(),
          transformCover: () => null,
          chapters: [{ title: "C", html: "<p>a</p>" }],
        });
        const files = unzipToText(epub);

        expect(files["EPUB/text/cover.xhtml"]).toBeUndefined();
        expect(files["EPUB/content.opf"]).not.toContain('properties="cover-image"');
      });
    });

    describe("coverFromLeadImage", () => {
      it("promotes a leading content image to the cover and removes it from the body", async () => {
        const epub = await generateEpub({
          title: "B",
          coverFromLeadImage: true,
          fetch: sizedPngFetch(600, 800),
          chapters: [{ title: "C", html: '<img src="https://x/lead.png"><p>Body text</p>' }],
        });
        const files = unzipToText(epub);

        expect(files["EPUB/images/cover.png"]).toBeDefined();
        expect(files["EPUB/text/cover.xhtml"]).toContain("<svg");
        expect(files["EPUB/text/chapter-1.xhtml"]).not.toContain("<img");
        expect(files["EPUB/text/chapter-1.xhtml"]).toContain("Body text");
      });

      it("leaves a mid-content image alone (no cover promoted)", async () => {
        const epub = await generateEpub({
          title: "B",
          coverFromLeadImage: true,
          fetch: sizedPngFetch(600, 800),
          chapters: [{ title: "C", html: '<p>Intro</p><img src="https://x/mid.png">' }],
        });
        const files = unzipToText(epub);

        expect(files["EPUB/text/cover.xhtml"]).toBeUndefined();
        expect(files["EPUB/text/chapter-1.xhtml"]).toContain('src="../images/img-1.png"');
      });
    });
  });

  it("is deterministic for identical input", async () => {
    const input = {
      title: "Same",
      author: "A",
      date: "2026-01-01T00:00:00Z",
      chapters: [{ title: "C", html: "<p>x</p>" }],
    };
    const a = await generateEpub(input);
    const b = await generateEpub(input);

    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("throws when no chapters are given", async () => {
    await expect(generateEpub({ title: "x", chapters: [] })).rejects.toThrow(
      /at least one chapter/,
    );
  });
});

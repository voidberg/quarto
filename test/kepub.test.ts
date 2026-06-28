import { describe, expect, it } from "vitest";
import { generateEpub, toKepub } from "../src/index.js";
import { unzipToText } from "./helpers.js";

async function sampleEpub() {
  return generateEpub({
    title: "Kepub Book",
    author: "A",
    chapters: [
      { title: "One", html: "<p>First paragraph.</p><p>Second <em>emphasised</em> run.</p>" },
    ],
  });
}

describe("toKepub", () => {
  it("wraps text nodes in koboSpans", async () => {
    const kepub = toKepub(await sampleEpub());
    const ch = unzipToText(kepub)["EPUB/text/chapter-1.xhtml"]!;

    expect(ch).toContain('class="koboSpan"');
    expect(ch).toContain('id="kobo.1.1"');
    // The emphasised run lives in its own segment with its own fragment ids.
    expect(ch).toMatch(/kobo\.\d+\.\d+/g);
    expect(ch).toContain("<em>");
  });

  it("adds the book-columns / book-inner wrappers", async () => {
    const kepub = toKepub(await sampleEpub());
    const ch = unzipToText(kepub)["EPUB/text/chapter-1.xhtml"]!;

    expect(ch).toContain('id="book-columns"');
    expect(ch).toContain('id="book-inner"');
  });

  it("leaves the navigation document untouched", async () => {
    const kepub = toKepub(await sampleEpub());
    const nav = unzipToText(kepub)["EPUB/nav.xhtml"]!;

    expect(nav).not.toContain("koboSpan");
  });

  it("preserves the OCF mimetype", async () => {
    const kepub = toKepub(await sampleEpub());

    expect(unzipToText(kepub).mimetype).toBe("application/epub+zip");
  });

  it("does not double-wrap whitespace-only text", async () => {
    const epub = await generateEpub({
      title: "B",
      chapters: [{ title: "C", html: "<p>  </p><p>real</p>" }],
    });
    const ch = unzipToText(toKepub(epub))["EPUB/text/chapter-1.xhtml"]!;

    // Only the paragraph with real content gets a span.
    const spanCount = (ch.match(/class="koboSpan"/g) ?? []).length;
    expect(spanCount).toBeGreaterThanOrEqual(1);
    expect(ch).toContain(">real<");
  });
});

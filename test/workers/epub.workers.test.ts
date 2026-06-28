import { describe, expect, it } from "vitest";
import { generateEpub, toKepub } from "../../src/index.js";

// This suite runs inside workerd (see vitest.workers.config.ts). If quarto ever
// reaches for a Node built-in or a non-bundlable dependency, this fails.
describe("quarto in the Cloudflare Workers runtime (workerd)", () => {
  it("generates a valid EPUB and converts it to a kepub", async () => {
    const epub = await generateEpub({
      title: "Worker Test",
      author: "Cloudflare",
      includeToc: false,
      // A data: image exercises the image pipeline with no network call.
      chapters: [
        {
          title: "Hello",
          html: '<p>Generated inside <strong>workerd</strong>.</p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="/>',
          excludeFromToc: true,
        },
      ],
    });

    // PK\x03\x04 — the zip/EPUB magic bytes.
    expect([...epub.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const kepub = toKepub(epub);
    expect(kepub.length).toBeGreaterThan(0);
  });
});

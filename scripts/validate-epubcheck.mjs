// Generate a spread of fixtures and validate every one with EPUBCheck.
// Run after `pnpm build`. Requires Java + epubcheck.jar (EPUBCHECK_JAR env,
// defaults to ./epubcheck.jar). Network-free so it works in CI sandboxes.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateEpub, toKepub } from "../dist/index.js";

const JAR = process.env.EPUBCHECK_JAR ?? "epubcheck.jar";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMEAYEjQ4dJAAAAAElFTkSuQmCC";
const coverBytes = Uint8Array.from(atob(PNG.split(",")[1]), (c) => c.charCodeAt(0));

const fixtures = {
  "basic.epub": {
    title: "A Basic Book",
    author: "Jane Doe",
    // Millisecond precision on purpose: dcterms:modified must be normalized to
    // second precision or EPUBCheck (RSC-005) rejects it.
    date: "2026-01-01T00:00:00.123Z",
    chapters: [
      { title: "One", html: "<p>Hello <strong>world</strong> &amp; friends.</p>" },
      { title: "Two", html: "<h2>Section</h2><p>More.</p><ul><li>a</li><li>b</li></ul>" },
    ],
  },
  "no-toc.epub": {
    title: "No TOC <Essay>",
    author: ["A. Writer", "B. Editor"],
    includeToc: false,
    chapters: [{ title: "Essay", html: "<p>Single essay.</p>", excludeFromToc: true }],
  },
  "with-cover.epub": {
    title: "Covered",
    cover: coverBytes,
    series: "Engineering & <Friends>",
    seriesIndex: 3,
    chapters: [{ title: "C", html: `<p>Body <img src="${PNG}" alt="dot"/></p>` }],
  },
  // Real-world messes EPUBCheck would otherwise reject — quarto sanitizes them
  // into the valid content model. Each line below previously produced an error.
  "messy-html.epub": {
    title: "Messy",
    chapters: [
      {
        title: "C",
        html: [
          "<p>unclosed<br>line<ul><li>x<li>y</ul>",
          "<script>alert(1)</script>",
          '<iframe src="https://embed.example/x"></iframe>',
          "<title>stray</title>",
          `<picture><source srcset="x.webp" type="image/webp"><img src="${PNG}" alt="p"></picture>`,
          "<div><figcaption>stray caption</figcaption></div>",
          "<footer>a<footer>b</footer></footer>",
          "<time>May 2025</time>",
          "<bdo>reversed</bdo>",
          '<form><p>subscribe</p><input name="email"></form>',
          "<dl><dd>early</dd><dt>term</dt></dl>",
          '<a href="https://a/>https://b">bad link</a>',
          '<span href="https://x">href on span</span>',
        ].join(""),
      },
    ],
  },
  "no-css.epub": {
    title: "Bare",
    css: false,
    chapters: [{ title: "C", html: "<p>no stylesheet</p>" }],
  },
  // downloadImages:false must drop external <img> so the book stays valid.
  "no-download-images.epub": {
    title: "No Download",
    downloadImages: false,
    chapters: [
      {
        title: "C",
        html: `<p>body <img src="https://example.com/cat.png"> <img src="${PNG}"/></p>`,
      },
    ],
  },
};

const dir = mkdtempSync(join(tmpdir(), "quarto-epubcheck-"));
let failed = 0;

for (const [name, input] of Object.entries(fixtures)) {
  const epub = await generateEpub(input);
  const kepub = toKepub(epub);
  for (const [label, bytes] of [
    [name, epub],
    [name.replace(/\.epub$/, ".kepub.epub"), kepub],
  ]) {
    const path = join(dir, label);
    writeFileSync(path, bytes);
    try {
      execFileSync("java", ["-jar", JAR, "--quiet", path], { stdio: "pipe" });
      console.log(`  ✓ ${label}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${label}`);
      console.error(String(err.stdout ?? "") + String(err.stderr ?? ""));
    }
  }
}

if (failed) {
  console.error(`\nEPUBCheck failed for ${failed} fixture(s).`);
  process.exit(1);
}
console.log("\nAll fixtures passed EPUBCheck.");

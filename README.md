![Quarto](assets/quarto.png)

# Quarto

[![npm](https://img.shields.io/npm/v/@voidberg/quarto.svg)](https://www.npmjs.com/package/@voidberg/quarto)
[![JSR](https://jsr.io/badges/@voidberg/quarto)](https://jsr.io/@voidberg/quarto)
[![CI](https://github.com/voidberg/quarto/actions/workflows/ci.yml/badge.svg)](https://github.com/voidberg/quarto/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> a book size of about 9½ x 12 inches (24 x 30 centimetres), determined by folding printed sheets twice to form four leaves or eight pages.

Generate **EPUB3** and Kobo **kepub** files from HTML - entirely in memory, with no native dependencies and no external binaries.

```ts
import { writeFile } from "node:fs/promises";
import { generateEpub, toKepub } from "@voidberg/quarto";

const epub = await generateEpub({
  title: "On the Shortness of Life",
  author: "Seneca",
  chapters: [{ title: "I", html: "<p>It is not that we have a short time to live...</p>" }],
});

await writeFile("seneca.epub", epub);            // or Deno.writeFile, Bun.write...
await writeFile("seneca.kepub.epub", toKepub(epub));
```

## Why another EPUB library?

Quarto came out of specific needs in my own projects (like [instakobo](https://github.com/voidberg/instakobo)):

- Skip the table of contents, which for articles and newsletters is just noise
- Generate kepubs without relying on kepubify
- Work in the browser

## Features

> [!NOTE]
> Quarto is battle-tested on **web articles** - it's been validated against nearly a thousand real-world articles (with EPUBCheck), since that's the use case it was built for. It should handle full-length books just as well, but this is not something that I have tested extensively. If you run into problems, please [open an issue](https://github.com/voidberg/quarto/issues).

- Valid EPUB3 (verified against [EPUBCheck](https://www.w3.org/publishing/epubcheck/) in CI)
- Optional table of contents (`includeToc`)
- Native kepub conversion (`toKepub`) - Kobo reading-location spans, no binary needed
- In-memory: returns a `Uint8Array`, never touches the filesystem
- Runtime-agnostic: Node, Deno, Bun, Cloudflare Workers, and the browser (Web APIs + [`fflate`](https://github.com/101arrowz/fflate))
- Re-serializes messy HTML into well-formed XHTML for you
- Downloads and embeds remote images so the book is self-contained
- Modern **ESM-only** (Node >= 18; `require()`-able from CommonJS on Node >= 20.19 / 22)

## Used by

- [instakobo](https://github.com/voidberg/instakobo) - Read and annotate (and sync back) your Instapaper articles on your Kobo device
- reSafari - Send webpages to your reMarkable tablet from Safari

## Install

```sh
npm install @voidberg/quarto       # npm / pnpm / yarn
deno add jsr:@voidberg/quarto      # Deno (JSR)
```

## API

### `generateEpub(input): Promise<Uint8Array>`

| Option              | Type                   | Default               | Notes |
|---------------------|------------------------|-----------------------|-------|
| `title`             | `string`               | -                     | Required. |
| `chapters`          | `Chapter[]`            | -                     | Required, at least one. |
| `author`            | `string \| string[]`   | -                     | One or many creators. |
| `includeToc`        | `boolean`              | `true`                | `false` -> no visible TOC page. |
| `tocTitle`          | `string`               | `"Table of Contents"` | Heading on the TOC page. |
| `cover`             | `string \| Uint8Array` | -                     | URL or raw bytes; generates a cover page. |
| `coverFromLeadImage`| `boolean`              | `false`               | Promote a chapter's leading image to the cover (see below). |
| `coverBackground`   | `string`               | reader default        | CSS colour filling the cover's letterbox bands. |
| `language`          | `string`               | `"en"`                | BCP-47 tag. |
| `css`               | `string \| false`      | bundled stylesheet    | `false` ships no CSS. |
| `downloadImages`    | `boolean`              | `true`                | Embed remote `<img>` sources. |
| `transformImage`    | `ImageTransform`       | -                     | Rewrite each image before embedding (see below). |
| `transformCover`    | `CoverTransform`       | -                     | Compose/replace the cover before embedding (see below). |
| `publisher`         | `string`               | -                     | |
| `description`       | `string`               | -                     | |
| `date`              | `string` (ISO-8601)    | -                     | Pass for reproducible builds. |
| `id`                | `string`               | derived (stable UUID) | Unique book identifier. |
| `fetch`             | `typeof fetch`         | global `fetch`        | Override for proxies/testing. |

A **`Chapter`** is `{ title, html, excludeFromToc?, author?, insertTitle? }`. `html` is an HTML fragment - it does not need to be well-formed; Quarto parses and re-serializes it as valid XHTML. Set `insertTitle: false` to suppress the auto-generated `<h1>` heading and render only your markup.

### `toKepub(epub: Uint8Array): Uint8Array`

Converts an EPUB (such as the output of `generateEpub`) into a Kobo kepub: every content document is rewritten with `koboSpan` reading-location markers and Kobo's `book-columns` / `book-inner` wrappers. Write the result with a `.kepub.epub` extension. No `kepubify` binary required.

### `DEFAULT_CSS: string`

The bundled stylesheet, exported so you can extend rather than replace it.

### `imageSize(bytes, mime): { width, height } | undefined`

Reads an image's pixel dimensions straight from its header - no decoding, no native deps. Supports PNG, GIF and JPEG; returns `undefined` for anything else or malformed data. Handy inside a `transformCover` to make layout decisions.

## Images & covers

By default every `<img>` source (and the `cover`) is downloaded and embedded so the book is self-contained. Two hooks let you customize what gets stored:

- **`transformImage(image)`** runs on each fetched image *before* the core-media-type check, so it can transcode an unsupported format (e.g. WebP/AVIF -> PNG for older e-readers), resize, or return `null` to drop the image.
- **`transformCover(cover, meta)`** runs after the cover source is downloaded and passed through `transformImage`. It's called **even when there's no cover source**, so you can compose a designed cover from `meta.title` / `meta.author` alone. Return `null` for no cover.

Both receive/return `RawImage` (`{ data: Uint8Array; mime: string }`) and may be async.

```ts
import { generateEpub, imageSize, type CoverTransform } from "@voidberg/quarto";

const brandCover: CoverTransform = (cover, meta) => {
  if (cover && imageSize(cover.data, cover.mime)) return cover; // usable as-is
  return renderCover(meta.title, meta.author);                 // your designer -> RawImage
};

await generateEpub({
  title: "Field Notes",
  coverFromLeadImage: true,        // no cover? promote the article's leading image
  coverBackground: "#f4f1ea",      // blend the letterbox bands into the artwork
  transformCover: brandCover,
  chapters: [{ title: "Field Notes", html }],
});
```

`coverFromLeadImage` only promotes an image that appears **before any text** in the first chapter (and removes it from the body so it isn't shown twice); images that follow text are left in place.

## Example: no table of contents

```ts
const epub = await generateEpub({
  title: "A Single Essay",
  includeToc: false,
  chapters: [{ title: "Essay", html: essayHtml, excludeFromToc: true }],
});
```

## Development

```sh
npm install
git config core.hooksPath .githooks  # one-time: enable the pre-push test gate
npm test          # vitest
npm run test:workers # vitest in the Cloudflare Workers runtime (workerd)
npm run build     # tsc -> dist (ESM + d.ts)
npm run typecheck
npm run validate  # EPUBCheck (needs Java + EPUBCHECK_JAR)
```

The `pre-push` hook (in `.githooks/`) runs typecheck, lint, and tests before a push; the slower Workers and EPUBCheck suites run in CI. EPUBCheck runs in CI against generated fixtures to guarantee spec compliance.

## Thanks to

- [epub-gen](https://github.com/cyrilis/epub-gen) and [epub-gen-memory](https://github.com/cpiber/epub-gen-memory) for inspiration.
- [kepubify](https://github.com/pgaskin/kepubify) for documenting the kepub transform.
- [epub-css-starter-kit](https://github.com/mattharrison/epub-css-starter-kit) for the styles.
- [Freepik - Flaticon](https://www.flaticon.com/free-icons/book) for the logo.

## License

[MIT](./LICENSE) © Alexandru Badiu

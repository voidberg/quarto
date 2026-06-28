/**
 * Default EPUB stylesheet. Adapted from the public-domain
 * epub-css-starter-kit (https://github.com/mattharrison/epub-css-starter-kit) —
 * conservative defaults that render well across e-readers, Kobo included.
 */
export const DEFAULT_CSS: string = `@charset "UTF-8";

html, body {
  margin: 0;
  padding: 0;
}

body {
  font-family: serif;
  line-height: 1.5;
  text-align: justify;
  padding: 0 1em;
  widows: 2;
  orphans: 2;
}

h1, h2, h3, h4, h5, h6 {
  font-family: sans-serif;
  line-height: 1.2;
  text-align: left;
  page-break-after: avoid;
  break-after: avoid;
  -webkit-hyphens: none;
  hyphens: none;
}

h1 {
  font-size: 1.6em;
  margin: 1em 0 0.6em;
}

h2 { font-size: 1.4em; }
h3 { font-size: 1.2em; }

p {
  margin: 0;
  text-indent: 1.2em;
}

p:first-of-type,
h1 + p,
h2 + p,
h3 + p,
blockquote p:first-child {
  text-indent: 0;
}

a { color: inherit; text-decoration: underline; }

img {
  max-width: 100%;
  height: auto;
}

figure { margin: 1em 0; text-align: center; }
figcaption { font-size: 0.85em; font-style: italic; text-align: center; }

blockquote {
  margin: 1em 1.5em;
  font-style: italic;
}

pre, code, kbd, samp {
  font-family: monospace;
  white-space: pre-wrap;
}

pre {
  font-size: 0.85em;
  margin: 1em 0;
  overflow-wrap: break-word;
}

hr {
  border: none;
  border-top: 1px solid currentColor;
  margin: 1.5em auto;
  width: 25%;
  opacity: 0.4;
}

ul, ol { margin: 1em 0; padding-left: 1.5em; }

table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid currentColor; padding: 0.3em 0.6em; }

.quarto-title { text-align: left; }
.quarto-author {
  font-family: sans-serif;
  font-size: 0.9em;
  font-style: italic;
  margin: 0 0 1.5em;
}

.quarto-cover {
  margin: 0;
  padding: 0;
  text-align: center;
  height: 100%;
  page-break-after: always;
}
.quarto-cover img { max-width: 100%; max-height: 100%; }
`;

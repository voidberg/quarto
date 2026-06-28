import { parse, parseFragment } from "parse5";

/**
 * Minimal structural view of parse5's default tree nodes. parse5 returns
 * objects with exactly these shapes; we narrow with the `nodeName` tag rather
 * than importing the full tree-adapter type surface.
 */
interface Attr {
  name: string;
  value: string;
  namespace?: string;
  prefix?: string;
}

interface ElementNode {
  nodeName: string;
  tagName: string;
  attrs: Attr[];
  childNodes: Node[];
}

interface TextNode {
  nodeName: "#text";
  value: string;
}

interface CommentNode {
  nodeName: "#comment";
  data: string;
}

interface ParentNode {
  childNodes: Node[];
}

type Node = ElementNode | TextNode | CommentNode | { nodeName: string };

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// Inline elements whose content model is phrasing-only: they may not contain
// block/flow elements. (`a`, `ins`, `del`, `map` are transparent — excluded.)
const PHRASING_ONLY = new Set([
  "span",
  "em",
  "strong",
  "b",
  "i",
  "u",
  "s",
  "small",
  "mark",
  "code",
  "kbd",
  "samp",
  "sub",
  "sup",
  "abbr",
  "cite",
  "q",
  "dfn",
  "time",
  "var",
  "bdi",
  "bdo",
  "big",
  "tt",
]);

// Block/flow elements that may not appear inside phrasing content.
const BLOCK_ELEMENTS = new Set([
  "div",
  "p",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
  "main",
  "figure",
  "figcaption",
  "blockquote",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "caption",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "pre",
  "form",
  "fieldset",
  "address",
]);

function isText(node: Node): node is TextNode {
  return node.nodeName === "#text";
}
function isComment(node: Node): node is CommentNode {
  return node.nodeName === "#comment";
}
function isElement(node: Node): node is ElementNode {
  return "tagName" in node && Array.isArray((node as ElementNode).attrs);
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(value: string): string {
  // Only &, < and " need escaping in a double-quoted XML attribute value;
  // regular spaces are valid and must be preserved (so e.g. multi-token class
  // names and alt/title text survive intact).
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/** Serialize a parse5 node list as well-formed XHTML. */
function serializeNodes(nodes: Node[]): string {
  let out = "";
  for (const node of nodes) {
    if (isText(node)) {
      out += escapeText(node.value);
    } else if (isComment(node)) {
      out += `<!--${node.data}-->`;
    } else if (isElement(node)) {
      const tag = node.tagName;
      const attrs = node.attrs
        .map((a) => {
          const name = a.prefix ? `${a.prefix}:${a.name}` : a.name;
          return ` ${name}="${escapeAttr(a.value)}"`;
        })
        .join("");
      if (VOID_ELEMENTS.has(tag) && node.childNodes.length === 0) {
        out += `<${tag}${attrs}/>`;
      } else {
        out += `<${tag}${attrs}>${serializeNodes(node.childNodes)}</${tag}>`;
      }
    }
  }

  return out;
}

/** Walk every element in a subtree, depth-first. */
function walkElements(nodes: Node[], visit: (el: ElementNode) => void): void {
  for (const node of nodes) {
    if (isElement(node)) {
      visit(node);
      walkElements(node.childNodes, visit);
    }
  }
}

/**
 * Browsers (and parse5) tolerate block elements nested inside phrasing-only
 * inline elements like `<span><div>…</div></span>`, but that violates the XHTML
 * content model and EPUBCheck rejects it. Bottom-up, rewrite any phrasing-only
 * element that contains a block child into a `<div>` (keeping its attributes), so
 * the structure becomes valid without losing content.
 */
function fixBlockInPhrasing(nodes: Node[]): void {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    fixBlockInPhrasing(node.childNodes);

    if (
      PHRASING_ONLY.has(node.tagName) &&
      node.childNodes.some((c) => isElement(c) && BLOCK_ELEMENTS.has(c.tagName))
    ) {
      node.nodeName = "div";
      node.tagName = "div";
    }
  }
}

function getAttr(el: ElementNode, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}
function setAttr(el: ElementNode, name: string, value: string): void {
  const existing = el.attrs.find((a) => a.name === name);
  if (existing) existing.value = value;
  else el.attrs.push({ name, value });
}

/** A parsed HTML fragment ready to inspect, mutate and serialize. */
export class HtmlFragment {
  private readonly nodes: Node[];

  private constructor(nodes: Node[]) {
    this.nodes = nodes;
  }

  static parse(html: string): HtmlFragment {
    const frag = parseFragment(html) as unknown as ParentNode;
    fixBlockInPhrasing(frag.childNodes);
    return new HtmlFragment(frag.childNodes);
  }

  /** Collect the `src` of every `<img>` (in document order). */
  imageSources(): string[] {
    const srcs: string[] = [];
    walkElements(this.nodes, (el) => {
      if (el.tagName === "img") {
        const src = getAttr(el, "src");
        if (src) srcs.push(src);
      }
    });
    return srcs;
  }

  /**
   * Walk every `<img>` (depth-first, splice-safe) and apply a decision based on
   * its `src`:
   *  - a string  → rewrite `src` to it (and ensure `alt`);
   *  - `null`    → remove the element;
   *  - `undefined` → leave it (and ensure `alt`).
   */
  private transformImages(decide: (src: string | undefined) => string | null | undefined): void {
    const process = (nodes: Node[]): void => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i]!;
        if (!isElement(node)) continue;
        if (node.tagName === "img") {
          const result = decide(getAttr(node, "src"));
          if (result === null) {
            nodes.splice(i, 1);
          } else {
            if (typeof result === "string") setAttr(node, "src", result);
            if (getAttr(node, "alt") === undefined) setAttr(node, "alt", "");
          }
        } else {
          process(node.childNodes);
        }
      }
    };

    process(this.nodes);
  }

  /**
   * Resolve every `<img>` against an embedded-image map (original src → in-package
   * path). Matched images are rewritten and given alt text. When
   * `stripUnresolved` is set, images that were not embedded (failed downloads,
   * unsupported sources) are removed entirely so the EPUB has no dangling
   * foreign resources — EPUBCheck rejects those.
   */
  resolveImages(map: Map<string, string>, stripUnresolved: boolean): void {
    this.transformImages((src) => {
      if (src && map.has(src)) return map.get(src)!;
      return stripUnresolved ? null : undefined;
    });
  }

  /**
   * Remove every `<img>` that references something outside the container — i.e.
   * anything that isn't an inline `data:` URI (remote URLs and relative paths
   * alike). Used when image downloading is disabled: only self-contained `data:`
   * images can survive, so this keeps the EPUB valid instead of leaving dangling
   * references EPUBCheck rejects.
   */
  stripExternalImages(): void {
    this.transformImages((src) => (src && /^data:/i.test(src) ? undefined : null));
  }

  /**
   * If the fragment's first meaningful content is an image (i.e. no text
   * precedes it), remove that image and return its `src` — for promoting an
   * article's lead image to the cover. Returns `undefined` when text comes first,
   * so we never pull an image out of the middle of the prose.
   */
  extractLeadImage(): string | undefined {
    let src: string | undefined;

    // A wrapper is "empty" if nothing but whitespace/comments remains.
    const isEmpty = (el: ElementNode): boolean =>
      el.childNodes.every((c) => isComment(c) || (isText(c) && c.value.trim() === ""));

    const visit = (nodes: Node[]): "img" | "text" | undefined => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!;
        if (isText(node)) {
          if (node.value.trim() !== "") return "text";
          continue;
        }
        if (!isElement(node)) continue;
        if (node.tagName === "img") {
          src = getAttr(node, "src");
          nodes.splice(i, 1);
          return "img";
        }
        const inner = visit(node.childNodes);
        if (inner === "img") {
          // The lead image lived inside this wrapper; drop it too if now empty
          // (a remaining <figcaption> etc. keeps it). Propagates up the nesting.
          if (isEmpty(node)) nodes.splice(i, 1);
          return "img";
        }
        if (inner === "text") return "text";
      }
      return undefined;
    };

    return visit(this.nodes) === "img" ? src : undefined;
  }

  serialize(): string {
    return serializeNodes(this.nodes);
  }
}

// --- kepub transform ---------------------------------------------------------

// Block-level tags whose text Kobo expects to be segmented for location tracking.
// (`pre` is intentionally absent — it lives in KOBO_SKIP, whose check runs first.)
const KOBO_SEGMENT_BLOCKS = new Set([
  "p",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "td",
  "th",
  "figcaption",
  "dd",
  "dt",
]);
// Never wrap text inside these.
const KOBO_SKIP = new Set(["script", "style", "pre", "audio", "video", "svg", "math"]);

/**
 * Transform an XHTML content document into its Kobo (kepub) form, mirroring
 * kepubify:
 *
 *  - every text run inside a block element is wrapped in
 *    `<span class="koboSpan" id="kobo.{segment}.{fragment}">` so the firmware can
 *    track reading position and anchor highlights precisely;
 *  - the body content is wrapped in `<div id="book-columns"><div id="book-inner">`
 *    which Kobo relies on for pagination and justification.
 *
 * Returns a complete XHTML document string. If the input has no parseable
 * `<body>`, it is returned unchanged.
 */
export function kepubifyXhtml(documentHtml: string): string {
  const doc = parse(documentHtml) as unknown as ParentNode;
  const html = findElement(doc.childNodes, "html");
  const body = html ? findElement(html.childNodes, "body") : undefined;
  if (!html || !body) return documentHtml;

  const counter = { segment: 0 };
  wrapTextNodes(body.childNodes, counter);

  const inner: ElementNode = {
    nodeName: "div",
    tagName: "div",
    attrs: [{ name: "id", value: "book-inner" }],
    childNodes: body.childNodes,
  };
  const columns: ElementNode = {
    nodeName: "div",
    tagName: "div",
    attrs: [{ name: "id", value: "book-columns" }],
    childNodes: [inner],
  };
  body.childNodes = [columns];

  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n${serializeNodes([html])}\n`;
}

function findElement(nodes: Node[], tagName: string): ElementNode | undefined {
  for (const node of nodes) {
    if (isElement(node)) {
      if (node.tagName === tagName) return node;
      const nested = findElement(node.childNodes, tagName);
      if (nested) return nested;
    }
  }

  return undefined;
}

/**
 * Recurse into the tree, treating each block in {@link KOBO_SEGMENT_BLOCKS} as
 * one location segment and wrapping its text via {@link wrapInline}.
 *
 * Known simplification vs. full kepubify: only text inside a recognised block
 * is wrapped. Loose text that sits directly in a non-block container (e.g. a
 * bare text node under a `<div>`) is left unwrapped, and a block nested inside
 * another block shares its parent's segment number. Content that quarto itself
 * generates is always block-wrapped, so this only affects arbitrary inputs and
 * costs Kobo a little location-tracking granularity — never validity.
 */
function wrapTextNodes(nodes: Node[], counter: { segment: number }): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (isElement(node)) {
      if (KOBO_SKIP.has(node.tagName)) continue;
      if (KOBO_SEGMENT_BLOCKS.has(node.tagName)) {
        counter.segment++;
        wrapInline(node, counter.segment);
      } else {
        wrapTextNodes(node.childNodes, counter);
      }
    }
  }
}

/**
 * Wrap each non-empty text node within a block in its own koboSpan, numbering
 * fragments sequentially. Nested inline elements keep their structure; only the
 * text leaves are wrapped.
 */
function wrapInline(block: ElementNode, segment: number): void {
  const fragment = { n: 0 };
  const transform = (nodes: Node[]): Node[] => {
    const result: Node[] = [];
    for (const node of nodes) {
      if (isText(node)) {
        if (node.value.trim() === "") {
          result.push(node);
          continue;
        }
        fragment.n++;
        result.push(koboSpan(segment, fragment.n, [node]));
      } else if (isElement(node) && !KOBO_SKIP.has(node.tagName)) {
        node.childNodes = transform(node.childNodes);
        result.push(node);
      } else {
        result.push(node);
      }
    }
    return result;
  };

  block.childNodes = transform(block.childNodes);
}

function koboSpan(segment: number, fragment: number, children: Node[]): ElementNode {
  return {
    nodeName: "span",
    tagName: "span",
    attrs: [
      { name: "class", value: "koboSpan" },
      { name: "id", value: `kobo.${segment}.${fragment}` },
    ],
    childNodes: children,
  };
}

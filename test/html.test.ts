import { describe, expect, it } from "vitest";
import { HtmlFragment } from "../src/html.js";

describe("HtmlFragment.extractLeadImage", () => {
  it("promotes a leading image and removes it from the body", () => {
    const fragment = HtmlFragment.parse('<img src="lead.png"><p>Body text</p>');

    expect(fragment.extractLeadImage()).toBe("lead.png");
    const out = fragment.serialize();
    expect(out).not.toContain("<img");
    expect(out).toContain("Body text");
  });

  it("treats a whitespace-only / wrapper prefix as still leading and drops the empty wrapper", () => {
    const fragment = HtmlFragment.parse('\n  <figure><img src="a.png"/></figure><p>x</p>');

    expect(fragment.extractLeadImage()).toBe("a.png");
    const out = fragment.serialize();
    expect(out).not.toContain("<figure");
    expect(out).not.toContain("<img");
    expect(out).toContain("<p>x</p>");
  });

  it("removes nested empty wrappers up the chain", () => {
    const fragment = HtmlFragment.parse('<div><p><img src="a.png"></p></div><p>body</p>');

    expect(fragment.extractLeadImage()).toBe("a.png");
    const out = fragment.serialize();
    expect(out).toBe("<p>body</p>");
  });

  it("keeps a wrapper that still has other content (e.g. a caption)", () => {
    const fragment = HtmlFragment.parse(
      '<figure><img src="a.png"/><figcaption>Caption</figcaption></figure><p>x</p>',
    );

    expect(fragment.extractLeadImage()).toBe("a.png");
    const out = fragment.serialize();
    expect(out).toContain("<figure>");
    expect(out).toContain("<figcaption>Caption</figcaption>");
    expect(out).not.toContain("<img");
  });

  it("does not promote an image that follows text", () => {
    const fragment = HtmlFragment.parse('<p>Intro</p><img src="mid.png">');

    expect(fragment.extractLeadImage()).toBeUndefined();
    expect(fragment.serialize()).toContain("mid.png");
  });
});

describe("HtmlFragment.parse sanitization", () => {
  const clean = (html: string) => HtmlFragment.parse(html).serialize();

  it("strips <script>", () => {
    expect(clean("<p>a</p><script>alert(1)</script><p>b</p>")).toBe("<p>a</p><p>b</p>");
  });

  it("strips remote <iframe> embeds", () => {
    expect(clean('<p>x</p><iframe src="https://embed.example/yt"></iframe>')).toBe("<p>x</p>");
  });

  it("strips a stray head-only <title> from body content", () => {
    expect(clean("<title>Doc</title><p>x</p>")).toBe("<p>x</p>");
  });

  it("reduces <picture> to its <img> fallback", () => {
    const out = clean(
      '<picture><source srcset="a.webp" type="image/webp"><img src="a.jpg" alt="A"></picture>',
    );
    expect(out).toBe('<img src="a.jpg" alt="A"/>');
  });

  it("drops a <picture> with no <img>", () => {
    expect(clean('<p>x</p><picture><source srcset="a.webp"></picture>')).toBe("<p>x</p>");
  });

  it("demotes a <figcaption> outside a <figure> to <div>", () => {
    expect(clean("<div><figcaption>Stray</figcaption></div>")).toBe("<div><div>Stray</div></div>");
  });

  it("keeps a <figcaption> inside a <figure>", () => {
    expect(clean('<figure><img src="a.jpg" alt=""/><figcaption>C</figcaption></figure>')).toContain(
      "<figcaption>C</figcaption>",
    );
  });

  it("demotes a nested <footer> to <div>", () => {
    expect(clean("<footer>outer<footer>inner</footer></footer>")).toBe(
      "<footer>outer<div>inner</div></footer>",
    );
  });

  it("adds a dir attribute to <bdo> when missing, keeps an existing one", () => {
    expect(clean("<bdo>x</bdo>")).toBe('<bdo dir="ltr">x</bdo>');
    expect(clean('<bdo dir="rtl">x</bdo>')).toBe('<bdo dir="rtl">x</bdo>');
  });

  it("drops href from a non-anchor element", () => {
    expect(clean('<span href="https://x">y</span>')).toBe("<span>y</span>");
  });

  it("drops a malformed href URL but keeps the anchor text", () => {
    expect(clean('<a href="https://a/>https://b">link</a>')).toBe("<a>link</a>");
  });

  it("keeps a valid anchor href", () => {
    expect(clean('<a href="https://example.com/x">link</a>')).toBe(
      '<a href="https://example.com/x">link</a>',
    );
  });

  it("keeps a well-formed definition list", () => {
    expect(clean("<dl><dt>Term</dt><dd>Def</dd></dl>")).toBe("<dl><dt>Term</dt><dd>Def</dd></dl>");
  });

  it("demotes a malformed <dl> (indentation hack) and its dt/dd to <div>", () => {
    expect(clean("<dl><dd>early</dd><dt>term</dt></dl>")).toBe(
      "<div><div>early</div><div>term</div></div>",
    );
  });

  it("demotes a <time> without datetime to <span>, keeps one with datetime", () => {
    expect(clean("<time>May 2025</time>")).toBe("<span>May 2025</span>");
    expect(clean('<time datetime="2025-05">May 2025</time>')).toBe(
      '<time datetime="2025-05">May 2025</time>',
    );
  });

  it("unwraps <form> (keeping text) and strips its controls", () => {
    expect(clean('<p>a</p><form><p>join</p><input name="email"></form><p>b</p>')).toBe(
      "<p>a</p><p>join</p><p>b</p>",
    );
  });
});

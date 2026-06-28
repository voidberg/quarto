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

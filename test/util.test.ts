import { describe, expect, it } from "vitest";
import { imageSize } from "../src/util.js";
import { pngBytes } from "./helpers.js";

describe("imageSize", () => {
  it("reads PNG dimensions", () => {
    expect(imageSize(pngBytes(640, 480), "image/png")).toEqual({ width: 640, height: 480 });
  });

  it("reads GIF dimensions", () => {
    const gif = new Uint8Array(10);
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // "GIF89a"
    gif[6] = 0x20; // width 32 (little-endian)
    gif[8] = 0x10; // height 16 (little-endian)
    expect(imageSize(gif, "image/gif")).toEqual({ width: 32, height: 16 });
  });

  it("returns undefined for unsupported or truncated data", () => {
    expect(imageSize(new Uint8Array([1, 2, 3]), "image/webp")).toBeUndefined();
    expect(imageSize(new Uint8Array([1, 2, 3]), "image/png")).toBeUndefined();
  });
});

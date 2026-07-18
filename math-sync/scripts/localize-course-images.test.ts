// Red-first tests for the course-image localizer (external ![](https://…) refs →
// local assets/ files so lessons render fully offline).

import { describe, expect, test } from "bun:test";
import { assetNameFor, findExternalImages, rewriteImageRefs } from "./localize-course-images.ts";

describe("findExternalImages", () => {
  test("finds http(s) image refs, ignores local ones", () => {
    const md = [
      "![graph](https://iscontent.byu.edu/Media/Images/05-lesson5.jpg)",
      "![already local](assets/foo.png)",
      "plain ![inline](http://x.test/a.png) text",
    ].join("\n");
    expect(findExternalImages(md)).toEqual([
      "https://iscontent.byu.edu/Media/Images/05-lesson5.jpg",
      "http://x.test/a.png",
    ]);
  });
});

describe("assetNameFor", () => {
  test("stable, keeps basename + extension, disambiguates by URL hash", () => {
    const a = assetNameFor("https://x.test/Images/05-lesson5.jpg");
    const b = assetNameFor("https://x.test/Other/05-lesson5.jpg");
    expect(a).toMatch(/^05-lesson5-[0-9a-f]{8}\.jpg$/);
    expect(a).toBe(assetNameFor("https://x.test/Images/05-lesson5.jpg"));
    expect(a).not.toBe(b);
  });
  test("handles query strings and missing extensions", () => {
    expect(assetNameFor("https://x.test/img?id=7")).toMatch(/^img-[0-9a-f]{8}$/);
  });
});

describe("rewriteImageRefs", () => {
  test("rewrites only downloaded URLs, is idempotent", () => {
    const md = "![g](https://x.test/a.jpg) and ![h](https://x.test/missing.jpg)";
    const map = new Map([["https://x.test/a.jpg", "a-12345678.jpg"]]);
    const once = rewriteImageRefs(md, map);
    expect(once).toBe("![g](assets/a-12345678.jpg) and ![h](https://x.test/missing.jpg)");
    expect(rewriteImageRefs(once, map)).toBe(once);
  });
});

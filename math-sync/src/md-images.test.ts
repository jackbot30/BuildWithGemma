import { describe, expect, test } from "bun:test";
// The renderer lives in public/ (browser JS) but transformImages is DOM-free on
// purpose so it can be verified here.
import { transformImages } from "../public/md-images.js";

describe("transformImages — online/offline course diagrams", () => {
  test("network images become an offline-safe placeholder with NO live src", () => {
    const html = transformImages(
      "![A number line](https://iscontent.byu.edu/img/fig-1.svg)",
    );
    expect(html).toContain('class="net-img net-img--offline"');
    expect(html).toContain('data-net-src="https://iscontent.byu.edu/img/fig-1.svg"');
    expect(html).toContain("<figcaption>A number line</figcaption>");
    // The airplane-mode guarantee: no <img> element is emitted, so nothing is
    // fetched until syncNetworkImages() hydrates it in online mode.
    expect(html).not.toContain("<img");
  });

  test("http images are handled the same as https", () => {
    const html = transformImages("![d](http://example.com/d.png)");
    expect(html).toContain('data-net-src="http://example.com/d.png"');
    expect(html).not.toContain("<img");
  });

  test("local course assets render as a served <img> via /course-asset/", () => {
    const html = transformImages("![Graph](assets/graph_01.png)");
    expect(html).toBe(
      '<img src="/course-asset/graph_01.png" alt="Graph" loading="lazy" />',
    );
  });

  test("other/relative images degrade to their alt text (no img, no request)", () => {
    const html = transformImages("![just text](foo/bar.png)");
    expect(html).toBe("just text");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("net-img");
  });

  test("non-image text is left untouched", () => {
    expect(transformImages("plain **not an image** line")).toBe(
      "plain **not an image** line",
    );
  });
});

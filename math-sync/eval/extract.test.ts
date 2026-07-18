/**
 * Tests for the eval's answer extraction. Every "real failure" case below is taken
 * verbatim from the invalidated Jul 18 e2b run, where the extractor graded markdown
 * fragments ("**", "### Method", "$$m = \frac{8}{4}$$") instead of the model's math.
 */

import { describe, expect, test } from "bun:test";
import { extractAnswer } from "./extract.ts";

describe("extractAnswer — ANSWER line", () => {
  test("plain ANSWER line", () => {
    expect(extractAnswer("5x = 15 so x = 3.\nANSWER: 3")).toBe("3");
  });

  test("markdown-bold ANSWER line (real e2b failure: got '**')", () => {
    expect(extractAnswer("Solving gives x = 3.\n\n**ANSWER:** x = 3")).toBe("3");
  });

  test("LaTeX-wrapped ANSWER value with chained equality", () => {
    expect(extractAnswer("ANSWER: $x = \\frac{15}{5} = 3$")).toBe("3");
  });

  test("multi-root, comma-separated", () => {
    expect(extractAnswer("Factor: (x-2)(x-3)=0.\nANSWER: 2, 3")).toBe("2, 3");
  });

  test("multi-root with 'or' and x =", () => {
    expect(extractAnswer("ANSWER: x = 2 or x = -2")).toBe("2, -2");
  });

  test("vertex as ordered pair keeps both coordinates", () => {
    expect(extractAnswer("Vertex form gives it.\nANSWER: (3, -4)")).toBe("3, -4");
  });

  test("plus-minus expands to both roots", () => {
    expect(extractAnswer("ANSWER: x = \\pm 2")).toBe("2, -2");
  });

  test("last ANSWER line wins when the model repeats the token", () => {
    expect(extractAnswer("I must end with ANSWER: <value>.\nSo x=5.\nANSWER: 5")).toBe("5");
  });
});

describe("extractAnswer — fallback when no ANSWER line", () => {
  test("$$-wrapped fraction (real e2b failure: got '$$m = \\frac{8}{4}$$')", () => {
    expect(extractAnswer("The slope is\n$$m = \\frac{8}{4}$$")).toBe("(8)/(4)");
  });

  test("skips trailing markdown junk and finds the math line (real e2b tail: '### Method' / '**')", () => {
    const reply = "$$x = 2 \\quad \\text{or} \\quad x = -2$$\n### Method\n**";
    expect(extractAnswer(reply)).toBe("2, -2");
  });

  test("markdown/heading-only garbage yields empty, never '**'", () => {
    expect(extractAnswer("### Method\n**")).toBe("");
  });

  test("truncated mid-LaTeX reply yields empty (real e2b failure: got 'We have $a =')", () => {
    expect(extractAnswer("To find the vertex:\nWe have $a =")).toBe("");
  });

  test("empty input", () => {
    expect(extractAnswer("")).toBe("");
  });

  test("prose with stray words is not mistaken for math", () => {
    expect(extractAnswer("Take 2 apples and 3 oranges")).toBe("");
  });
});

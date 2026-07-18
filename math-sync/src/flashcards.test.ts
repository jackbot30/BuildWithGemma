// Red-first tests for flashcards: validation + Anki TSV export.

import { describe, expect, test } from "bun:test";
import { validateCards, toAnkiTsv } from "./flashcards.ts";

describe("validateCards", () => {
  test("accepts trimmed front/back pairs, rejects empties with reasons", () => {
    const { accepted, rejected } = validateCards([
      { front: " What is the origin? ", back: "(0, 0)" },
      { front: "", back: "orphan back" },
      { front: "no back", back: "   " },
    ]);
    expect(accepted).toEqual([{ front: "What is the origin?", back: "(0, 0)" }]);
    expect(rejected.map((r) => r.index)).toEqual([1, 2]);
    expect(rejected[0]?.reason).toContain("front");
    expect(rejected[1]?.reason).toContain("back");
  });

  test("caps at 30 cards", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ front: `q${i}`, back: `a${i}` }));
    const { accepted, rejected } = validateCards(many);
    expect(accepted.length).toBe(30);
    expect(rejected.length).toBe(10);
  });

  test("non-string fields rejected, not thrown", () => {
    const { accepted, rejected } = validateCards([
      { front: 42 as unknown as string, back: "a" },
    ]);
    expect(accepted).toEqual([]);
    expect(rejected.length).toBe(1);
  });
});

describe("toAnkiTsv", () => {
  test("tab-separated front/back, one card per line", () => {
    const tsv = toAnkiTsv([
      { front: "What is the origin?", back: "(0, 0)" },
      { front: "Slope formula", back: "m = (y2-y1)/(x2-x1)" },
    ]);
    expect(tsv).toBe("What is the origin?\t(0, 0)\nSlope formula\tm = (y2-y1)/(x2-x1)");
  });

  test("tabs/newlines inside fields become spaces so Anki columns stay intact", () => {
    const tsv = toAnkiTsv([{ front: "a\tb\nc", back: "d\ne" }]);
    expect(tsv).toBe("a b c\td e");
  });
});

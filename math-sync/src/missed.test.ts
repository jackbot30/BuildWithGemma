// Red-first tests for the "missed quiz question → SRS flashcard" logic
// (public/missed.js — plain ESM, DOM-free, shared by the browser and these tests).

import { describe, expect, test } from "bun:test";
// @ts-expect-error — plain JS module without type declarations, by design (browser-shared)
import { qualifies, buildCard, addMissedCard, MISSED_DECK_TITLE } from "../public/missed.js";

describe("qualifies", () => {
  test("a pass on the first try does NOT qualify", () => {
    expect(qualifies({ pass: true, attempts: 1, expected: "3" })).toBe(false);
  });

  test("a pass after a single miss (2nd attempt) does NOT qualify", () => {
    expect(qualifies({ pass: true, attempts: 2, expected: "3" })).toBe(false);
  });

  test("a pass after 2+ misses (3rd attempt) qualifies", () => {
    expect(qualifies({ pass: true, attempts: 3, expected: "3" })).toBe(true);
  });

  test("the 3rd failed attempt (the reveal) qualifies", () => {
    expect(qualifies({ pass: false, attempts: 3, expected: "3" })).toBe(true);
  });

  test("an early miss without a revealed answer does NOT qualify", () => {
    // attempts < 3 → expected not revealed by the server yet
    expect(qualifies({ pass: false, attempts: 1, expected: undefined })).toBe(false);
    expect(qualifies({ pass: false, attempts: 2, expected: undefined })).toBe(false);
  });

  test("no revealed expected answer never qualifies, even at 3 attempts", () => {
    expect(qualifies({ pass: false, attempts: 3, expected: "" })).toBe(false);
    expect(qualifies({ pass: false, attempts: 3 })).toBe(false);
  });

  test("garbage input never qualifies", () => {
    expect(qualifies(null)).toBe(false);
    expect(qualifies({})).toBe(false);
  });
});

describe("buildCard", () => {
  test("front is the question, back is the expected answer, both trimmed", () => {
    const card = buildCard("  Solve x + 1 = 3  ", "  2  ");
    expect(card).toEqual({ front: "Solve x + 1 = 3", back: "2" });
  });

  test("a fresh card carries no srs state (→ new in the next study session)", () => {
    expect("srs" in buildCard("q", "a")).toBe(false);
  });
});

describe("addMissedCard", () => {
  const card = (front: string, back = "a") => ({ front, back });

  test("creates the Missed questions deck when none exists", () => {
    const { decks, added } = addMissedCard([], card("Q1"));
    expect(added).toBe(true);
    expect(decks).toHaveLength(1);
    expect(decks[0].title).toBe(MISSED_DECK_TITLE);
    expect(decks[0].cards).toEqual([card("Q1")]);
  });

  test("appends into the existing Missed questions deck, newest first", () => {
    const start = [{ title: MISSED_DECK_TITLE, cards: [card("Q1")] }];
    const { decks, added } = addMissedCard(start, card("Q2"));
    expect(added).toBe(true);
    expect(decks[0].title).toBe(MISSED_DECK_TITLE);
    expect(decks[0].cards.map((c: { front: string }) => c.front)).toEqual(["Q2", "Q1"]);
  });

  test("dedupes by front text (no duplicate, added=false, store untouched)", () => {
    const start = [{ title: MISSED_DECK_TITLE, cards: [card("Q1")] }];
    const { decks, added } = addMissedCard(start, card("  Q1  "));
    expect(added).toBe(false);
    expect(decks).toBe(start); // unchanged reference — nothing written
  });

  test("finds the Missed deck among other decks and moves it to the front", () => {
    const start = [
      { title: "Lesson 1.1", cards: [card("x")] },
      { title: MISSED_DECK_TITLE, cards: [card("Q1")] },
    ];
    const { decks, added } = addMissedCard(start, card("Q2"));
    expect(added).toBe(true);
    expect(decks[0].title).toBe(MISSED_DECK_TITLE);
    expect(decks.find((d: { title: string }) => d.title === "Lesson 1.1")).toBeTruthy();
    expect(decks).toHaveLength(2);
  });

  test("preserves other decks' fields and does not mutate the input array", () => {
    const start = [{ title: "Lesson 1.1", cards: [card("x")], savedAt: "2026-07-18" }];
    const { decks } = addMissedCard(start, card("Q1"));
    expect(start).toHaveLength(1); // input untouched
    expect(decks.find((d: { title: string }) => d.title === "Lesson 1.1")?.savedAt).toBe("2026-07-18");
  });

  test("an empty front is never added", () => {
    const { decks, added } = addMissedCard([], card("   "));
    expect(added).toBe(false);
    expect(decks).toEqual([]);
  });

  test("caps the deck list to maxDecks, keeping the Missed deck at the front", () => {
    const start = Array.from({ length: 20 }, (_, i) => ({ title: `D${i}`, cards: [] }));
    const { decks } = addMissedCard(start, card("Q1"), 20);
    expect(decks).toHaveLength(20);
    expect(decks[0].title).toBe(MISSED_DECK_TITLE);
  });
});

// Red-first: composer-intent detection (drives the nudge + requiredTool enforcement).
// Two real failures this morning came from phrasings the old regex missed.

import { describe, expect, test } from "bun:test";
import { detectComposerIntent } from "./intent.ts";

describe("detectComposerIntent — flashcards", () => {
  const yes = [
    "can you make me flashcards for hte first units?", // real failure, typo included
    "Create flashcards for lesson 1.1",
    "make me some flash cards on slope",
    "export anki cards for unit 2",
    "make me cards to study quadratics",
    "study cards for 1.4 please",
  ];
  for (const m of yes) {
    test(`"${m}" → create_flashcards`, () => {
      expect(detectComposerIntent(m)).toBe("create_flashcards");
    });
  }
});

describe("detectComposerIntent — quiz", () => {
  const yes = [
    "quiz me on lesson 1.1",
    "test me on quadratics",
    "give me practice problems for unit 3",
    "drill me on the distance formula",
    "can I get a quiz over unit 2?",
  ];
  for (const m of yes) {
    test(`"${m}" → create_quiz`, () => {
      expect(detectComposerIntent(m)).toBe("create_quiz");
    });
  }
});

describe("detectComposerIntent — neither", () => {
  const no = [
    "Solve x^2 - 5x + 6 = 0",
    "what is a report card grade weight?", // "card" but not flashcards
    "explain the unit circle",
    "how do I practice better study habits?", // 'practice' without problems/quiz intent
    "what does this test statistic mean?", // 'test' as noun-in-content
  ];
  for (const m of no) {
    test(`"${m}" → undefined`, () => {
      expect(detectComposerIntent(m)).toBeUndefined();
    });
  }
});

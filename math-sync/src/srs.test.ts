// Red-first tests for the Anki-style SM-2 scheduler (public/srs.js — plain ESM,
// shared by the browser and these tests; no DOM access allowed in that file).

import { describe, expect, test } from "bun:test";
// @ts-expect-error — plain JS module without type declarations, by design (browser-shared)
import { newCardState, grade, buildQueue, LEARNING_STEPS_MS } from "../public/srs.js";

const MIN = 60_000;
const DAY = 86_400_000;
const t0 = 1_000_000_000_000; // fixed clock

describe("learning phase", () => {
  test("new card starts in learning at step 0, due now", () => {
    const s = newCardState(t0);
    expect(s.phase).toBe("learning");
    expect(s.step).toBe(0);
    expect(s.due).toBe(t0);
  });

  test("Good advances a step (10m), then graduates to 1-day review", () => {
    let s = newCardState(t0);
    s = grade(s, "good", t0);
    expect(s.phase).toBe("learning");
    expect(s.step).toBe(1);
    expect(s.due).toBe(t0 + LEARNING_STEPS_MS[1]);
    s = grade(s, "good", t0);
    expect(s.phase).toBe("review");
    expect(s.intervalDays).toBe(1);
    expect(s.due).toBe(t0 + DAY);
  });

  test("Again resets to step 0 (1m); Hard repeats the current step", () => {
    let s = grade(newCardState(t0), "good", t0); // at step 1
    expect(grade(s, "again", t0).step).toBe(0);
    expect(grade(s, "hard", t0).step).toBe(1);
  });

  test("Easy graduates immediately at 4 days", () => {
    const s = grade(newCardState(t0), "easy", t0);
    expect(s.phase).toBe("review");
    expect(s.intervalDays).toBe(4);
  });
});

describe("review phase", () => {
  const review = { phase: "review", step: 0, ef: 2.5, intervalDays: 10, lapses: 0, reps: 5, due: t0 };

  test("Good multiplies interval by ease", () => {
    const s = grade(review, "good", t0);
    expect(s.intervalDays).toBe(25); // 10 * 2.5
    expect(s.due).toBe(t0 + 25 * DAY);
    expect(s.ef).toBe(2.5);
  });

  test("Hard = interval x1.2 and ease drops 0.15", () => {
    const s = grade(review, "hard", t0);
    expect(s.intervalDays).toBe(12);
    expect(s.ef).toBeCloseTo(2.35);
  });

  test("Easy = interval x ease x1.3 and ease grows 0.15", () => {
    const s = grade(review, "easy", t0);
    expect(s.intervalDays).toBe(33); // round(10*2.5*1.3)
    expect(s.ef).toBeCloseTo(2.65);
  });

  test("Again lapses: back to learning, ease -0.2 floored at 1.3, lapse counted", () => {
    const s = grade(review, "again", t0);
    expect(s.phase).toBe("learning");
    expect(s.step).toBe(0);
    expect(s.lapses).toBe(1);
    expect(s.ef).toBeCloseTo(2.3);
    expect(grade({ ...review, ef: 1.35 }, "again", t0).ef).toBe(1.3);
  });
});

describe("buildQueue", () => {
  test("due learning first, then due reviews, then new (capped)", () => {
    const cards = [
      { id: "new1", srs: undefined },
      { id: "rev", srs: { phase: "review", step: 0, ef: 2.5, intervalDays: 1, lapses: 0, reps: 1, due: t0 - MIN } },
      { id: "learn", srs: { phase: "learning", step: 1, ef: 2.5, intervalDays: 0, lapses: 0, reps: 1, due: t0 - MIN } },
      { id: "future", srs: { phase: "review", step: 0, ef: 2.5, intervalDays: 9, lapses: 0, reps: 2, due: t0 + DAY } },
    ];
    const q = buildQueue(cards, t0, 20);
    expect(q.map((c: { id: string }) => c.id)).toEqual(["learn", "rev", "new1"]);
  });

  test("new-card cap respected", () => {
    const cards = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, srs: undefined }));
    expect(buildQueue(cards, t0, 5).length).toBe(5);
  });
});

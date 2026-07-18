/**
 * feat/quiz — quiz store, problem validation, deterministic grading.
 * Written red-first: quiz.ts did not exist when this file was written.
 */

import { describe, expect, test } from "bun:test";
import { validateProblems, createQuiz, getQuiz, gradeAnswer } from "./quiz.ts";

describe("validateProblems", () => {
  test("accepts a numeric problem whose expected evaluates", () => {
    const r = validateProblems([{ question: "What is 1+2?", expected: "3", type: "numeric" }]);
    expect(r.accepted.length).toBe(1);
    expect(r.rejected.length).toBe(0);
  });

  test("accepts an expression problem whose expected parses", () => {
    const r = validateProblems([{ question: "Simplify x + x + 1", expected: "2x+1", type: "expression" }]);
    expect(r.accepted.length).toBe(1);
    expect(r.rejected.length).toBe(0);
  });

  test("accepts a multi-value numeric expected like '-1, 2'", () => {
    const r = validateProblems([{ question: "Solve x^2 - x - 2 = 0", expected: "-1, 2", type: "numeric" }]);
    expect(r.accepted.length).toBe(1);
  });

  test("rejects a numeric expected containing a free variable", () => {
    const r = validateProblems([{ question: "q", expected: "x + 1", type: "numeric" }]);
    expect(r.accepted.length).toBe(0);
    expect(r.rejected).toEqual([{ index: 0, reason: expect.stringContaining("numeric") }]);
  });

  test("rejects an expected that does not parse", () => {
    const r = validateProblems([{ question: "q", expected: "2 +* 3", type: "expression" }]);
    expect(r.rejected.length).toBe(1);
    expect(r.rejected[0]?.index).toBe(0);
  });

  test("rejects malformed entries (missing fields, bad type, non-object)", () => {
    const r = validateProblems([
      { question: "", expected: "3", type: "numeric" },
      { question: "q", expected: "", type: "numeric" },
      { question: "q", expected: "3", type: "multiple-choice" },
      "not an object",
    ]);
    expect(r.accepted.length).toBe(0);
    expect(r.rejected.map((x) => x.index)).toEqual([0, 1, 2, 3]);
  });

  test("keeps accepted/rejected indexes aligned with the input order", () => {
    const r = validateProblems([
      { question: "a", expected: "3", type: "numeric" },
      { question: "b", expected: "??", type: "numeric" },
      { question: "c", expected: "2x", type: "expression" },
    ]);
    expect(r.accepted.map((p) => p.question)).toEqual(["a", "c"]);
    expect(r.rejected.map((x) => x.index)).toEqual([1]);
  });
});

describe("quiz store", () => {
  test("createQuiz assigns incrementing ids and getQuiz retrieves", () => {
    const a = createQuiz("Quiz A", [{ question: "1+1?", expected: "2", type: "numeric" }]);
    const b = createQuiz("Quiz B", [{ question: "2+2?", expected: "4", type: "numeric" }]);
    expect(b.id).toBe(a.id + 1);
    expect(getQuiz(a.id)?.title).toBe("Quiz A");
  });

  test("store keeps only the last 20 quizzes", () => {
    const first = createQuiz("evict-me", [{ question: "q", expected: "1", type: "numeric" }]);
    for (let i = 0; i < 20; i++) {
      createQuiz(`filler ${i}`, [{ question: "q", expected: "1", type: "numeric" }]);
    }
    expect(getQuiz(first.id)).toBeUndefined();
  });
});

describe("gradeAnswer", () => {
  test("correct numeric answer passes and reveals expected", () => {
    const q = createQuiz("g1", [{ question: "1+2?", expected: "3", type: "numeric" }]);
    const r = gradeAnswer(q.id, 0, "3");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.pass).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.expected).toBe("3");
  });

  test("equivalent expression answer passes (symbolic equality, not string match)", () => {
    const q = createQuiz("g2", [{ question: "simplify", expected: "2x+1", type: "expression" }]);
    const r = gradeAnswer(q.id, 0, "x + x + 1");
    if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}`);
    expect(r.pass).toBe(true);
  });

  test("multi-value expected grades order-independently", () => {
    const q = createQuiz("g3", [{ question: "roots", expected: "-1, 2", type: "numeric" }]);
    const r = gradeAnswer(q.id, 0, "x = 2 or x = -1");
    if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}`);
    expect(r.pass).toBe(true);
  });

  test("wrong answer fails without revealing expected (attempts 1 and 2)", () => {
    const q = createQuiz("g4", [{ question: "1+2?", expected: "3", type: "numeric" }]);
    const r1 = gradeAnswer(q.id, 0, "4");
    if (r1.status !== "ok") throw new Error("unreachable");
    expect(r1.pass).toBe(false);
    expect(r1.attempts).toBe(1);
    expect(r1.expected).toBeUndefined();
    const r2 = gradeAnswer(q.id, 0, "5");
    if (r2.status !== "ok") throw new Error("unreachable");
    expect(r2.attempts).toBe(2);
    expect(r2.expected).toBeUndefined();
  });

  test("third failed attempt reveals expected", () => {
    const q = createQuiz("g5", [{ question: "1+2?", expected: "3", type: "numeric" }]);
    gradeAnswer(q.id, 0, "4");
    gradeAnswer(q.id, 0, "4");
    const r3 = gradeAnswer(q.id, 0, "4");
    if (r3.status !== "ok") throw new Error("unreachable");
    expect(r3.pass).toBe(false);
    expect(r3.attempts).toBe(3);
    expect(r3.expected).toBe("3");
  });

  test("normalizes the student's answer for display", () => {
    const q = createQuiz("g6", [{ question: "q", expected: "3", type: "numeric" }]);
    const r = gradeAnswer(q.id, 0, "  1 +2 ");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.normalized).toBe("1 + 2");
  });

  test("unparseable student answer fails gracefully (no throw)", () => {
    const q = createQuiz("g7", [{ question: "q", expected: "3", type: "numeric" }]);
    const r = gradeAnswer(q.id, 0, "???");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.pass).toBe(false);
  });

  test("unknown quiz id → quiz-not-found", () => {
    expect(gradeAnswer(999999, 0, "3").status).toBe("quiz-not-found");
  });

  test("out-of-range problem index → bad-index", () => {
    const q = createQuiz("g8", [{ question: "q", expected: "3", type: "numeric" }]);
    expect(gradeAnswer(q.id, 5, "3").status).toBe("bad-index");
    expect(gradeAnswer(q.id, -1, "3").status).toBe("bad-index");
  });
});

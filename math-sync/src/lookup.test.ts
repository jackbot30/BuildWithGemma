/**
 * Tests for the improved lookup scoring (S3).
 * Written RED-first: scoreLessons / lookupCourse improvements do not yet exist.
 */

import { describe, expect, test } from "bun:test";
import { scoreLessons } from "./lookup.ts";
import type { Lesson } from "./course.ts";

// ---------------------------------------------------------------------------
// Fixture: ~12 fake lessons shaped like the real course.
// IDs follow the real naming convention "unit-lesson-slug".
// ---------------------------------------------------------------------------

function lesson(id: string, title: string, body: string): Lesson {
  return { id, title, content: `# ${title}\n\n${body}` };
}

const FIXTURE: Lesson[] = [
  lesson(
    "1-1-the-coordinate-plane",
    "1.1 The Coordinate Plane",
    "Learn to plot points on a coordinate plane using ordered pairs (x, y). " +
      "Understand quadrants and axes.",
  ),
  lesson(
    "1-2-distance-and-midpoint",
    "1.2 Distance and Midpoint",
    "Use the distance formula d = sqrt((x2-x1)^2 + (y2-y1)^2) and midpoint formula. " +
      "Apply to find the length of a segment.",
  ),
  lesson(
    "1-3-dividing-by-ratio",
    "1.3 Dividing by Ratio",
    "Divide a segment into a given ratio using the section formula.",
  ),
  lesson(
    "2-1-geometric-solids",
    "2.1 Geometric Solids",
    "Surface area and volume of prisms, cylinders, cones, and spheres.",
  ),
  lesson(
    "3-1-parabolas",
    "3.1 Parabolas",
    "Conic sections: standard form of a parabola, vertex, focus, directrix.",
  ),
  lesson(
    "6-1-quadratic-equations",
    "6.1 Quadratic Equations",
    "Solve quadratic equations ax^2 + bx + c = 0 by factoring, completing the square, " +
      "and the quadratic formula x = (-b ± sqrt(b^2 - 4ac)) / (2a).",
  ),
  lesson(
    "6-2-solving-by-quadratic-formula",
    "6.2 Solving by Quadratic Formula",
    "Apply the quadratic formula to solve x^2 = 1 and x^2 + 2x - 3 = 0. " +
      "Practice with discriminants. Example: solve x^2 - 1 = 0.",
  ),
  lesson(
    "7-1-exponential-functions",
    "7.1 Exponential Functions",
    "Properties of f(x) = a^x. Growth and decay. Asymptotes.",
  ),
  lesson(
    "8-1-arithmetic-sequences",
    "8.1 Arithmetic Sequences",
    "Arithmetic sequences and series. Sum formulas.",
  ),
  lesson(
    "10-1-values-of-trig-functions",
    "10.1 Values of Trigonometric Functions",
    "Evaluate sin, cos, tan at standard angles. SOHCAHTOA.",
  ),
  lesson(
    "10-3-application-problems",
    "10.3 Application Problems",
    "Real-world trigonometry: angles of elevation and depression, navigation problems.",
  ),
  lesson(
    "10-11-inverse-trig",
    "10.11 Inverse Trigonometric Functions",
    "arcsin, arccos, arctan definitions and ranges. Evaluate and apply.",
  ),
];

// ---------------------------------------------------------------------------
// Helper: run scoreLessons and return ids in score order (highest first)
// ---------------------------------------------------------------------------
function rank(query: string, lessons = FIXTURE): string[] {
  return scoreLessons(lessons, query).map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scoreLessons — S3 retrieval fix", () => {
  // --- id-pattern queries ---

  test('"1.1" returns lesson 1-1 first', () => {
    const results = rank("1.1");
    expect(results[0]).toBe("1-1-the-coordinate-plane");
  });

  test('"10.3" returns 10-3, not 1-0 or 3-x variants', () => {
    const results = rank("10.3");
    expect(results[0]).toBe("10-3-application-problems");
    // Must not pick up 10-1, 10-11, 1-x, or 3-x before 10-3
    const top3 = results.slice(0, 3);
    expect(top3).toContain("10-3-application-problems");
    expect(top3[0]).toBe("10-3-application-problems");
  });

  test('"10.11" returns 10-11 first', () => {
    expect(rank("10.11")[0]).toBe("10-11-inverse-trig");
  });

  // --- title-phrase queries ---

  test('"coordinate plane" → 1-1 first', () => {
    expect(rank("coordinate plane")[0]).toBe("1-1-the-coordinate-plane");
  });

  test('"distance and midpoint" → 1-2 first', () => {
    expect(rank("distance and midpoint")[0]).toBe("1-2-distance-and-midpoint");
  });

  // --- body-only phrase (confirmed live failure) ---

  test('"solve x^2 = 1" → a quadratic lesson first, not distance/midpoint', () => {
    const results = rank("solve x^2 = 1");
    // 6-2 or 6-1 should win; distance lesson (1-2) must NOT be first
    expect(results[0]).not.toBe("1-2-distance-and-midpoint");
    // a quadratic lesson should appear in top 2
    const top2 = results.slice(0, 2);
    const quadraticFirst = top2.some((id) => id.startsWith("6-"));
    expect(quadraticFirst).toBe(true);
  });

  test("body-only phrase still found when not in title/id", () => {
    // "SOHCAHTOA" only appears in 10-1's body
    const results = rank("SOHCAHTOA");
    expect(results[0]).toBe("10-1-values-of-trig-functions");
  });

  // --- term frequency: repeated hits count ---

  test("repeated keyword in body raises score above single-hit lesson", () => {
    // 6-2 body mentions "solve" twice, x^2, x^2-1; should outscore a lesson mentioning solve once
    const results = rank("quadratic formula");
    const top = results.slice(0, 2).map((id) => id);
    // both 6-1 and 6-2 mention quadratic formula; one of them should be first
    expect(top.some((id) => id.startsWith("6-"))).toBe(true);
  });

  // --- no-match fallback: zero scores → empty array from scoreLessons ---

  test("query with no matches returns empty array (caller handles fallback)", () => {
    // "zymurgy fermentation" matches nothing in the fixture
    const results = scoreLessons(FIXTURE, "zymurgy fermentation");
    expect(results).toHaveLength(0);
  });

  // --- sample-course regression: 2-lesson course stays sensible ---

  const SAMPLE: Lesson[] = [
    lesson(
      "01-linear-equations",
      "Lesson 1 — Linear Equations",
      "A linear equation in one variable: ax + b = 0. Slope-intercept form y = mx + b.",
    ),
    lesson(
      "02-quadratics",
      "Lesson 2 — Quadratic Functions",
      "Quadratic function y = ax^2 + bx + c. The quadratic formula x = (-b ± sqrt(b^2-4ac))/(2a).",
    ),
  ];

  test("sample-course: 'quadratic' returns 02-quadratics first", () => {
    expect(rank("quadratic", SAMPLE)[0]).toBe("02-quadratics");
  });

  test("sample-course: 'linear' returns 01-linear-equations first", () => {
    expect(rank("linear", SAMPLE)[0]).toBe("01-linear-equations");
  });

  test("sample-course: no match returns empty array", () => {
    expect(scoreLessons(SAMPLE, "trigonometry")).toHaveLength(0);
  });
});

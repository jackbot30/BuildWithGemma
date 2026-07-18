// Tests for the course outline parser (Units → Lessons) used by /api/course/outline.
// Written red-first: buildOutline does not exist yet.

import { describe, expect, test } from "bun:test";
import { buildOutline } from "./outline.ts";
import type { Lesson } from "./course.ts";

const lesson = (id: string, title: string): Lesson => ({
  id,
  title,
  content: `# ${title}\n\nbody`,
});

const L1 = lesson("01-linear-equations", "Lesson 1 — Linear Equations");
const L2 = lesson("02-quadratics", "Lesson 2 — Quadratic Functions");
const L3 = lesson("03-systems", "Lesson 3 — Systems of Equations");

describe("buildOutline", () => {
  test("sample-course shape: one generic '## Lessons' section falls back to the H1 title", () => {
    const syllabus = [
      "# Foundations of Algebra — Unit 3: Linear & Quadratic Functions",
      "",
      "## About this unit",
      "",
      "Prose, no links.",
      "",
      "## Lessons",
      "",
      "1. [Linear Equations](lessons/01-linear-equations.md) — slope-intercept form.",
      "2. [Quadratic Functions](lessons/02-quadratics.md) — the quadratic formula.",
    ].join("\n");

    const units = buildOutline(syllabus, [L1, L2]);
    expect(units).toEqual([
      {
        title: "Foundations of Algebra — Unit 3: Linear & Quadratic Functions",
        lessons: [
          { id: "01-linear-equations", title: "Lesson 1 — Linear Equations" },
          { id: "02-quadratics", title: "Lesson 2 — Quadratic Functions" },
        ],
      },
    ]);
  });

  test("multi-unit syllabus: each '##' section with lesson links becomes a unit, in order", () => {
    const syllabus = [
      "# Algebra I",
      "",
      "## Unit 1: Lines",
      "",
      "- [Linear Equations](lessons/01-linear-equations.md)",
      "",
      "## Unit 2: Parabolas",
      "",
      "- [Quadratics](lessons/02-quadratics.md)",
      "- [Systems](lessons/03-systems.md)",
    ].join("\n");

    const units = buildOutline(syllabus, [L1, L2, L3]);
    expect(units.map((u) => u.title)).toEqual(["Unit 1: Lines", "Unit 2: Parabolas"]);
    expect(units[0]?.lessons.map((l) => l.id)).toEqual(["01-linear-equations"]);
    expect(units[1]?.lessons.map((l) => l.id)).toEqual(["02-quadratics", "03-systems"]);
  });

  test("lesson titles come from the loaded lesson, not the syllabus link text", () => {
    const syllabus = "# C\n\n## Unit 1\n\n- [Some other name](lessons/01-linear-equations.md)";
    const units = buildOutline(syllabus, [L1]);
    expect(units[0]?.lessons[0]?.title).toBe("Lesson 1 — Linear Equations");
  });

  test("lessons on disk but not referenced in the syllabus land in a trailing 'More lessons' unit", () => {
    const syllabus = "# C\n\n## Unit 1\n\n- [One](lessons/01-linear-equations.md)";
    const units = buildOutline(syllabus, [L1, L2]);
    expect(units.map((u) => u.title)).toEqual(["Unit 1", "More lessons"]);
    expect(units[1]?.lessons.map((l) => l.id)).toEqual(["02-quadratics"]);
  });

  test("real-course shape: '## Unit N:' headings, no links — group by lesson-id unit prefix", () => {
    // The Buzz-exported syllabus lists lessons as plain bullets; lesson files are
    // named <unit>-<lesson>-<slug>.md. Units come from the headings, membership
    // from the id prefix, ordered numerically (10-2 before 10-11).
    const u1a = lesson("1-1-the-coordinate-plane", "1.1 The Coordinate Plane");
    const u1b = lesson("1-2-distance-and-midpoint", "1.2 Distance and Midpoint");
    const u10a = lesson("10-2-sine-cosine", "10.2 Sine and Cosine");
    const u10b = lesson("10-11-inverse-trig", "10.11 Inverse Trigonometric Functions");
    const extra = lesson("appendix-glossary", "Glossary");
    const syllabus = [
      "# MATH 056 — Course Outline",
      "",
      "## Orientation",
      "- Course Introduction",
      "",
      "## Unit 10: Trigonometric Functions",
      "- **10.2 Sine and Cosine**",
      "",
      "## Unit 1: Coordinate Geometry  👈 **current unit**",
      "- **1.1 The Coordinate Plane**",
    ].join("\n");

    const units = buildOutline(syllabus, [u1a, u1b, u10b, u10a, extra]);
    expect(units.map((u) => u.title)).toEqual([
      "Unit 10: Trigonometric Functions",
      "Unit 1: Coordinate Geometry",
      "More lessons",
    ]);
    expect(units[0]?.lessons.map((l) => l.id)).toEqual(["10-2-sine-cosine", "10-11-inverse-trig"]);
    expect(units[1]?.lessons.map((l) => l.id)).toEqual([
      "1-1-the-coordinate-plane",
      "1-2-distance-and-midpoint",
    ]);
    expect(units[2]?.lessons.map((l) => l.id)).toEqual(["appendix-glossary"]);
  });

  test("no syllabus (or no links): single unit with all lessons in load order", () => {
    expect(buildOutline("", [L1, L2])).toEqual([
      {
        title: "Course",
        lessons: [
          { id: "01-linear-equations", title: "Lesson 1 — Linear Equations" },
          { id: "02-quadratics", title: "Lesson 2 — Quadratic Functions" },
        ],
      },
    ]);
    const proseOnly = "# My Course\n\nJust prose, no lesson links.";
    const units = buildOutline(proseOnly, [L1]);
    expect(units).toEqual([
      { title: "My Course", lessons: [{ id: "01-linear-equations", title: "Lesson 1 — Linear Equations" }] },
    ]);
  });

  test("links to lesson files that are not loaded are skipped; duplicates are deduped", () => {
    const syllabus = [
      "# C",
      "## Unit 1",
      "- [Ghost](lessons/99-missing.md)",
      "- [One](lessons/01-linear-equations.md)",
      "- [One again](lessons/01-linear-equations.md)",
    ].join("\n");
    const units = buildOutline(syllabus, [L1]);
    expect(units).toEqual([
      { title: "Unit 1", lessons: [{ id: "01-linear-equations", title: "Lesson 1 — Linear Equations" }] },
    ]);
  });
});

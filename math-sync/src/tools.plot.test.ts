// Red-first: plot must sanitize model-supplied domains (probe-confirmed: [10,-10]
// was accepted and would render a blank/broken graph live).

import { describe, expect, test } from "bun:test";
import { dispatchTool, type ToolContext } from "./tools.ts";
import type { CoursePack } from "./course.ts";

const ctx = (): ToolContext => ({
  course: { dir: ".", syllabus: "", lessons: [] } as CoursePack,
  plots: [],
});

describe("plot domain guard", () => {
  test("inverted domain is swapped", () => {
    const c = ctx();
    dispatchTool("plot", { fn: "x^2", min: 10, max: -10 }, c);
    expect(c.plots[0]?.domain).toEqual([-10, 10]);
  });

  test("equal min/max falls back to default domain", () => {
    const c = ctx();
    dispatchTool("plot", { fn: "x^2", min: 3, max: 3 }, c);
    expect(c.plots[0]?.domain).toEqual([-10, 10]);
  });

  test("absurd range falls back to default domain", () => {
    const c = ctx();
    dispatchTool("plot", { fn: "x^2", min: -1e9, max: 1e9 }, c);
    expect(c.plots[0]?.domain).toEqual([-10, 10]);
  });

  test("normal domain untouched", () => {
    const c = ctx();
    dispatchTool("plot", { fn: "x^2", min: -5, max: 5 }, c);
    expect(c.plots[0]?.domain).toEqual([-5, 5]);
  });
});

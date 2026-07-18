/**
 * The `calculate` tool must be registered in the schema list (so Ollama sees
 * it) and dispatch through the same never-throw contract as the other tools.
 * Uses direct dispatch — no model call needed to prove wiring.
 */

import { describe, expect, test } from "bun:test";
import { dispatchTool, toolSchemas, type ToolContext } from "./tools.ts";
import type { CoursePack } from "./course.ts";

const ctx: ToolContext = {
  course: { dir: "test", lessons: [] } as unknown as CoursePack,
  plots: [],
};

describe("calculate tool", () => {
  test("is registered in toolSchemas for the model", () => {
    const names = toolSchemas.map((s) => s.function.name);
    expect(names).toContain("calculate");
  });

  test("evaluates an expression via dispatch", () => {
    const r = dispatchTool("calculate", { expression: "2 + 2 * 10" }, ctx);
    expect(r).toBe("2 + 2 * 10 = 22");
  });

  test("scientific expression", () => {
    const r = dispatchTool("calculate", { expression: "sqrt(144) + 3" }, ctx);
    expect(r).toBe("sqrt(144) + 3 = 15");
  });

  test("invalid expression returns an Error string, never throws", () => {
    const r = dispatchTool("calculate", { expression: "2 +* 3" }, ctx);
    expect(r.startsWith("Error:")).toBe(true);
  });

  test("wrong arg type returns an Error string, never throws", () => {
    const r = dispatchTool("calculate", { expression: 42 }, ctx);
    expect(r.startsWith("Error:")).toBe(true);
  });

  test("missing arg returns an Error string", () => {
    const r = dispatchTool("calculate", {}, ctx);
    expect(r.startsWith("Error:")).toBe(true);
  });
});

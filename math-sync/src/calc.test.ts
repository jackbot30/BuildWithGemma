/**
 * Tests for the calculator expression evaluator (src/calc.ts) and the
 * `calculate` Gemma tool. Errors must come back as strings — never throw
 * into the agent loop.
 */

import { describe, expect, test } from "bun:test";
import { calculateExpression } from "./calc.ts";

describe("calculateExpression", () => {
  test("basic arithmetic", () => {
    expect(calculateExpression("2 + 2")).toBe("4");
    expect(calculateExpression("7 * 6")).toBe("42");
    expect(calculateExpression("(3 + 5) / 2")).toBe("4");
  });

  test("scientific functions and constants", () => {
    expect(calculateExpression("sqrt(16)")).toBe("4");
    expect(calculateExpression("sin(pi / 2)")).toBe("1");
    expect(calculateExpression("log(e)")).toBe("1");
    expect(calculateExpression("2^10")).toBe("1024");
  });

  test("normalizes ** to ^ (models often emit Python power syntax)", () => {
    expect(calculateExpression("2 ** 3")).toBe("8");
  });

  test("cleans float noise (0.1 + 0.2 = 0.3, not 0.30000000000000004)", () => {
    expect(calculateExpression("0.1 + 0.2")).toBe("0.3");
  });

  test("fractions and negative results", () => {
    expect(calculateExpression("1/4")).toBe("0.25");
    expect(calculateExpression("3 - 10")).toBe("-7");
  });

  test("invalid syntax returns an Error string, never throws", () => {
    const r = calculateExpression("2 +* 3");
    expect(r.startsWith("Error:")).toBe(true);
  });

  test("undefined symbols return an Error string", () => {
    const r = calculateExpression("x + 1");
    expect(r.startsWith("Error:")).toBe(true);
  });

  test("empty / whitespace input returns an Error string", () => {
    expect(calculateExpression("").startsWith("Error:")).toBe(true);
    expect(calculateExpression("   ").startsWith("Error:")).toBe(true);
  });

  test("expressions that produce a function are rejected", () => {
    const r = calculateExpression("f(x) = x^2");
    expect(r.startsWith("Error:")).toBe(true);
  });

  test("non-finite results (division by zero) return an explicit Error, not Infinity", () => {
    const r = calculateExpression("1/0");
    expect(r).toBe("Error: result is not a finite number (division by zero?)");
  });

  test("-Infinity and NaN also return the non-finite Error", () => {
    expect(calculateExpression("-1/0")).toBe("Error: result is not a finite number (division by zero?)");
    expect(calculateExpression("0/0")).toBe("Error: result is not a finite number (division by zero?)");
  });
});

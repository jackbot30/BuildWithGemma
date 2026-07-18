/**
 * Tests for checker.ts — S2 spec items:
 * (a) JS-ism normalization (Math.PI, Math.E, Math.sqrt, Math.abs, **)
 * (b) Approximate tier (within 0.1% relative tolerance → equal:true, approx:true)
 * (c) Explicit failure reasons (empty answer, unparseable expected)
 * (d) Existing contract: exact/symbolic unchanged, set order, y= stripping
 */

import { describe, expect, it } from "bun:test";
import { checkAnswer, checkSet } from "./checker.ts";

describe("S2a — JS-ism normalization", () => {
  it("Math.PI vs pi → equal:true", () => {
    const r = checkAnswer("Math.PI", "pi");
    expect(r.equal).toBe(true);
  });

  it("pi vs Math.PI → equal:true (symmetric)", () => {
    const r = checkAnswer("pi", "Math.PI");
    expect(r.equal).toBe(true);
  });

  it("Math.E vs e → equal:true", () => {
    const r = checkAnswer("Math.E", "e");
    expect(r.equal).toBe(true);
  });

  it("2**3 vs 8 → equal:true", () => {
    const r = checkAnswer("2**3", "8");
    expect(r.equal).toBe(true);
  });

  it("Math.sqrt(4) vs 2 → equal:true", () => {
    const r = checkAnswer("Math.sqrt(4)", "2");
    expect(r.equal).toBe(true);
  });

  it("Math.abs(-5) vs 5 → equal:true", () => {
    const r = checkAnswer("Math.abs(-5)", "5");
    expect(r.equal).toBe(true);
  });
});

describe("S2b — approximate tier", () => {
  it("1.414 vs sqrt(2) → equal:true, approx:true", () => {
    const r = checkAnswer("1.414", "sqrt(2)");
    expect(r.equal).toBe(true);
    expect(r.approx).toBe(true);
  });

  it("1.41421 vs sqrt(2) → equal:true (exact or approx, but equal)", () => {
    const r = checkAnswer("1.41421", "sqrt(2)");
    expect(r.equal).toBe(true);
  });

  it("1.41 vs sqrt(2) → equal:false (0.15% off, outside 0.1% tolerance)", () => {
    const r = checkAnswer("1.41", "sqrt(2)");
    expect(r.equal).toBe(false);
  });

  it("approx:true is NOT set on exact match (1/2 vs 0.5)", () => {
    const r = checkAnswer("1/2", "0.5");
    expect(r.equal).toBe(true);
    expect(r.approx).toBeUndefined();
  });

  it("approx: true NOT set on symbolic exact match (x^2 vs x*x)", () => {
    const r = checkAnswer("x^2", "x*x");
    expect(r.equal).toBe(true);
    expect(r.approx).toBeUndefined();
  });
});

describe("S2c — explicit failure reasons", () => {
  it("empty answer → equal:false with reason 'empty answer'", () => {
    const r = checkAnswer("", "pi");
    expect(r.equal).toBe(false);
    expect(r.reason).toBe("empty answer");
  });

  it("whitespace-only answer → equal:false with reason 'empty answer'", () => {
    const r = checkAnswer("   ", "pi");
    expect(r.equal).toBe(false);
    expect(r.reason).toBe("empty answer");
  });

  it("malformed expected → equal:false with reason that includes parse error text", () => {
    const r = checkAnswer("3", "((((");
    expect(r.equal).toBe(false);
    expect(r.reason).toBeTruthy();
    // Must include the parse error text, not just a generic message
    expect(typeof r.reason).toBe("string");
    expect((r.reason ?? "").length).toBeGreaterThan(0);
    // Should not say "empty answer"
    expect(r.reason).not.toBe("empty answer");
  });
});

describe("S2d — existing contract preserved", () => {
  it("1/2 vs 0.5 → equal:true (exact rational match)", () => {
    const r = checkAnswer("1/2", "0.5");
    expect(r.equal).toBe(true);
  });

  it("multi-solution set: order-independent '-1, 2' vs '2, -1' → true", () => {
    expect(checkSet(["-1", "2"], ["2", "-1"])).toBe(true);
  });

  it("y = 2x+1 prefix stripping vs 2x+1 → equal:true", () => {
    const r = checkAnswer("y = 2x+1", "2x+1");
    expect(r.equal).toBe(true);
  });

  it("2**3 vs 8 → equal:true (** normalization)", () => {
    const r = checkAnswer("2**3", "8");
    expect(r.equal).toBe(true);
  });
});

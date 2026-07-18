/**
 * Tests for verify.ts — S1 spec: independent substitution-based verification.
 * Written RED-first (before verify.ts exists); green after implementation.
 */

import { describe, expect, it, test } from "bun:test";
import { verifySolution, type VerifyResult } from "./verify.ts";

// ── core substitution ────────────────────────────────────────────────────────

describe("quadratic — two solutions", () => {
  it("x^2 - 5x + 6 = 0, proposed '2, 3' → ok: true", () => {
    const r = verifySolution("x^2 - 5x + 6 = 0", "2, 3");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.verdicts).toHaveLength(2);
      for (const v of r.verdicts) expect(v.ok).toBe(true);
    }
  });

  it("wrong solution — '1, 2' → ok: false (1 fails)", () => {
    const r = verifySolution("x^2 - 5x + 6 = 0", "1, 2");
    expect(r.ok).toBe(false);
    // verdicts may be present showing which value failed
    if (!r.ok && r.verdicts) {
      const failing = r.verdicts.filter((v) => !v.ok);
      expect(failing.length).toBeGreaterThan(0);
    }
  });
});

describe("±1 parsing", () => {
  it("x^2 - 1 = 0, proposed '±1' → ok: true (both +1 and -1 checked)", () => {
    const r = verifySolution("x^2 - 1 = 0", "±1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.verdicts).toHaveLength(2);
    }
  });
});

describe("'x = 2 and x = 3' parsing", () => {
  it("parses variable-assignment form correctly", () => {
    const r = verifySolution("x^2 - 5x + 6 = 0", "x = 2 and x = 3");
    expect(r.ok).toBe(true);
  });
});

describe("implied '= 0' (no equals sign in equation)", () => {
  it("'x^2 - 5x + 6' (no equals) treated as = 0", () => {
    const r = verifySolution("x^2 - 5x + 6", "2, 3");
    expect(r.ok).toBe(true);
  });
});

describe("malformed / non-parseable input", () => {
  it("unparseable equation → ok: false with reason string", () => {
    const r = verifySolution("not an equation (((", "2");
    expect(r.ok).toBe(false);
    expect((r as { ok: false; reason?: string }).reason).toBeTruthy();
  });

  it("unparseable proposed value → ok: false with reason string", () => {
    const r = verifySolution("x + 1 = 3", "(((");
    expect(r.ok).toBe(false);
    expect((r as { ok: false; reason?: string }).reason).toBeTruthy();
  });

  it("empty proposed → ok: false with reason", () => {
    const r = verifySolution("x + 1 = 3", "");
    expect(r.ok).toBe(false);
    expect((r as { ok: false; reason?: string }).reason).toBeTruthy();
  });

  it("never throws — always returns VerifyResult", () => {
    expect(() => verifySolution("", "")).not.toThrow();
    expect(() => verifySolution("x = 1", "NaN")).not.toThrow();
  });
});

describe("equation in y", () => {
  it("'2y + 1 = 7', proposed 'y = 3' → ok: true", () => {
    const r = verifySolution("2y + 1 = 7", "y = 3");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.verdicts[0]?.value).toBe(3);
    }
  });
});

describe("tolerance near zero", () => {
  it("tiny residual (floating point rounding) passes", () => {
    // x^2 - 4 = 0 → x = 2; floating point gives ~0 not exactly 0
    const r = verifySolution("x^2 - 4 = 0", "2");
    expect(r.ok).toBe(true);
  });

  it("large residual fails", () => {
    // x^2 - 4 = 0 → x = 3 fails (lhs = 9-4=5, rhs = 0)
    const r = verifySolution("x^2 - 4 = 0", "3");
    expect(r.ok).toBe(false);
  });
});

// ── tools dispatch ────────────────────────────────────────────────────────────

describe("tools dispatch — verify_solution", () => {
  it("is exported from tools.ts", async () => {
    const { toolSchemas } = await import("./tools.ts");
    const names = toolSchemas.map((s) => s.function.name);
    expect(names).toContain("verify_solution");
  });

  it("happy path dispatch returns VERIFIED string", async () => {
    const { dispatchTool } = await import("./tools.ts");
    const ctx = { course: { dir: "test", syllabus: "", lessons: [] } as Parameters<typeof dispatchTool>[2]["course"], plots: [] };
    const r = dispatchTool("verify_solution", { equation: "x^2 - 5x + 6 = 0", proposed: "2, 3" }, ctx);
    expect(r.startsWith("VERIFIED")).toBe(true);
  });

  it("malformed input dispatch returns NOT VERIFIED string, never throws", async () => {
    const { dispatchTool } = await import("./tools.ts");
    const ctx = { course: { dir: "test", syllabus: "", lessons: [] } as Parameters<typeof dispatchTool>[2]["course"], plots: [] };
    const r = dispatchTool("verify_solution", { equation: "not an equation (((", proposed: "2" }, ctx);
    expect(r.startsWith("NOT VERIFIED")).toBe(true);
  });
});

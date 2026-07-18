/**
 * Independent solution verification via substitution.
 *
 * Given an equation like "x^2 - 5x + 6 = 0" and proposed solutions like
 * "2, 3", substitute each value into the equation and compare LHS vs RHS
 * numerically using mathjs. Never trusts the model — purely deterministic.
 *
 * Contract: NEVER throws. Always returns VerifyResult.
 */

import { create, all, type FactoryFunctionMap, type MathNode } from "mathjs";

const math = create(all as FactoryFunctionMap, {});

export interface SolutionVerdict {
  value: number;
  lhs: number;
  rhs: number;
  ok: boolean;
}

export type VerifyResult =
  | { ok: true; verdicts: SolutionVerdict[] }
  | { ok: false; verdicts?: SolutionVerdict[]; reason?: string };

/** Absolute tolerance (near-zero residuals). */
const ABS_TOL = 1e-9;
/** Relative tolerance (scaled by magnitude). */
const REL_TOL = 1e-9;

function residualOk(lhs: number, rhs: number): boolean {
  const diff = Math.abs(lhs - rhs);
  if (diff <= ABS_TOL) return true;
  const scale = Math.max(Math.abs(lhs), Math.abs(rhs), 1);
  return diff / scale <= REL_TOL;
}

/**
 * Strip a leading variable assignment ("x =", "y =") and return the bare
 * numeric string. Returns null if the string doesn't look like a value.
 */
function stripAssignment(s: string): string {
  // "x = 3" → "3", "y = -1.5" → "-1.5"
  return s.replace(/^\s*[a-zA-Z]\w*\s*=\s*/, "").trim();
}

/**
 * Parse proposed solutions string into an array of numeric values.
 * Handles: "2, 3", "x = 2 and x = 3", "±1", "y = 3"
 */
function parseProposed(proposed: string): { values: number[] } | { error: string } {
  const trimmed = proposed.trim();
  if (!trimmed) return { error: "proposed solution is empty" };

  const parts: string[] = [];

  // Handle ± notation: "±1" → "+1" and "-1"
  if (/[±]/.test(trimmed)) {
    const withoutPM = trimmed.replace(/[±]/g, "").trim();
    parts.push(withoutPM, `-${withoutPM}`);
  } else {
    // Split on "and", "or", comma, semicolon
    const raw = trimmed.split(/\bor\b|\band\b|,|;/i).map((p) => p.trim()).filter(Boolean);
    for (const p of raw) parts.push(p);
  }

  if (parts.length === 0) return { error: "no solution values found in proposed string" };

  const values: number[] = [];
  for (const part of parts) {
    const bare = stripAssignment(part);
    if (!bare) return { error: `could not parse part "${part}"` };
    let v: unknown;
    try {
      v = math.evaluate(bare);
    } catch (e) {
      return { error: `could not parse "${bare}": ${e instanceof Error ? e.message : String(e)}` };
    }
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { error: `"${bare}" does not evaluate to a finite number` };
    }
    values.push(v);
  }
  return { values };
}

/**
 * Parse an equation string into { lhsExpr, rhsExpr }.
 * If no "=" present, treats the whole expression as LHS with RHS = 0.
 */
function parseEquation(equation: string): { lhsExpr: string; rhsExpr: string } | { error: string } {
  const trimmed = equation.trim();
  if (!trimmed) return { error: "equation is empty" };

  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) {
    // No "=" — treat as "expr = 0"
    return { lhsExpr: trimmed, rhsExpr: "0" };
  }

  const lhs = trimmed.slice(0, eqIdx).trim();
  const rhs = trimmed.slice(eqIdx + 1).trim();
  if (!lhs) return { error: "equation has empty left-hand side" };
  if (!rhs) return { error: "equation has empty right-hand side" };
  return { lhsExpr: lhs, rhsExpr: rhs };
}

/**
 * Detect the free variable in an equation (single variable only).
 * Returns the variable name or an error.
 */
function detectVariable(lhsExpr: string, rhsExpr: string): { variable: string } | { error: string } {
  const knownConstants = new Set(["e", "pi", "i", "Infinity", "NaN", "true", "false"]);

  const vars = new Set<string>();
  for (const expr of [lhsExpr, rhsExpr]) {
    let node: MathNode;
    try {
      node = math.parse(expr);
    } catch (e) {
      return { error: `parse error in "${expr}": ${e instanceof Error ? e.message : String(e)}` };
    }
    const fnNames = new Set<string>();
    node.filter((n) => n.type === "FunctionNode").forEach((n: MathNode) => {
      const fn = (n as unknown as { fn?: { name?: string } }).fn;
      if (fn?.name) fnNames.add(fn.name);
    });
    node.filter((n) => n.type === "SymbolNode").forEach((n: MathNode) => {
      const name = (n as unknown as { name: string }).name;
      const known = (math as unknown as Record<string, unknown>)[name];
      if (!fnNames.has(name) && typeof known !== "function" && !knownConstants.has(name)) {
        vars.add(name);
      }
    });
  }

  if (vars.size === 0) return { error: "no variable found in equation" };
  if (vars.size > 1) {
    return { error: `multiple variables found (${[...vars].join(", ")}); only single-variable equations supported` };
  }
  return { variable: [...vars][0] as string };
}

/**
 * Verify proposed solutions by substitution.
 * Never throws — always returns VerifyResult.
 */
export function verifySolution(equation: string, proposed: string): VerifyResult {
  try {
    // 1. Parse the equation.
    const eqResult = parseEquation(equation);
    if ("error" in eqResult) return { ok: false, reason: eqResult.error };

    const { lhsExpr, rhsExpr } = eqResult;

    // 2. Parse the proposed values.
    const propResult = parseProposed(proposed);
    if ("error" in propResult) return { ok: false, reason: propResult.error };

    const { values } = propResult;

    // 3. Detect the variable.
    const varResult = detectVariable(lhsExpr, rhsExpr);
    if ("error" in varResult) return { ok: false, reason: varResult.error };

    const variable = varResult.variable;

    // 4. Compile LHS and RHS.
    let lhsCompiled: { evaluate(scope: Record<string, number>): unknown };
    let rhsCompiled: { evaluate(scope: Record<string, number>): unknown };
    try {
      lhsCompiled = math.parse(lhsExpr).compile() as { evaluate(scope: Record<string, number>): unknown };
    } catch (e) {
      return { ok: false, reason: `LHS parse error: ${e instanceof Error ? e.message : String(e)}` };
    }
    try {
      rhsCompiled = math.parse(rhsExpr).compile() as { evaluate(scope: Record<string, number>): unknown };
    } catch (e) {
      return { ok: false, reason: `RHS parse error: ${e instanceof Error ? e.message : String(e)}` };
    }

    // 5. Substitute each value.
    const verdicts: SolutionVerdict[] = [];
    for (const v of values) {
      const scope = { [variable]: v };
      let lhsVal: unknown;
      let rhsVal: unknown;
      try {
        lhsVal = lhsCompiled.evaluate(scope);
        rhsVal = rhsCompiled.evaluate(scope);
      } catch (e) {
        return {
          ok: false,
          verdicts,
          reason: `evaluation error for ${variable}=${v}: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
      if (typeof lhsVal !== "number" || !Number.isFinite(lhsVal)) {
        return { ok: false, verdicts, reason: `LHS is not finite for ${variable}=${v}` };
      }
      if (typeof rhsVal !== "number" || !Number.isFinite(rhsVal)) {
        return { ok: false, verdicts, reason: `RHS is not finite for ${variable}=${v}` };
      }
      const ok = residualOk(lhsVal, rhsVal);
      verdicts.push({ value: v, lhs: lhsVal, rhs: rhsVal, ok });
    }

    const allOk = verdicts.length > 0 && verdicts.every((v) => v.ok);
    if (allOk) return { ok: true, verdicts };

    return { ok: false, verdicts };
  } catch (e) {
    // Last-resort safety net — verifySolution must never throw.
    return { ok: false, reason: `unexpected error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

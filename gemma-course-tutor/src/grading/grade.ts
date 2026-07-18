/**
 * Reusable grading module — used by BOTH the eval harness and the tutor's optional
 * self-check. Ground truth is the answer key, never the model.
 *
 *  - numeric    → evaluate model answer + expected; set-compare within 1e-6
 *  - expression → parse both; assert equivalence at ~8 random points within 1e-9
 */

import { create, all, type MathNode, type FactoryFunctionMap } from "mathjs";
import { normalizeLatex } from "./latex.ts";

const math = create(all as FactoryFunctionMap, {});

export type ProblemType = "numeric" | "expression";

export interface GradeResult {
  pass: boolean;
  detail: string;
}

/** Split a possibly multi-valued answer ("x = 6, x = 4", "a \pm b") into bare parts.
 *  Splits on commas/semicolons only at paren depth 0, so combinations(12,4) stays intact. */
function splitValues(raw: string): string[] {
  const normalized = normalizeLatex(raw);
  const top: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of normalized) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) {
      top.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  top.push(cur);
  const parts = top
    .flatMap((p) => p.split(/\bor\b/i))
    .flatMap((p) => (p.includes("±") ? [p.replace("±", "+"), p.replace("±", "-")] : [p]))
    .map((p) => p.replace(/^[\s(]*[a-zA-Z]\w*\s*=\s*/, "").trim()) // strip "x =" / "y ="
    .filter(Boolean);
  return parts.length ? parts : [normalized];
}

function evalNumber(expr: string): number {
  const v: unknown = math.evaluate(expr);
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`not a finite number: ${expr}`);
  return v;
}

/** numeric grading: order-independent set match within tolerance. */
export function gradeNumeric(model: string, expected: string, tol = 1e-6): GradeResult {
  let got: number[];
  let exp: number[];
  try {
    got = splitValues(model).map(evalNumber);
    exp = splitValues(expected).map(evalNumber);
  } catch (e) {
    return { pass: false, detail: `parse/eval error: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (got.length !== exp.length) return { pass: false, detail: `count ${got.length} vs ${exp.length}` };
  const remaining = [...exp];
  for (const g of got) {
    const idx = remaining.findIndex((e) => Math.abs(g - e) <= tol * Math.max(1, Math.abs(e)));
    if (idx === -1) return { pass: false, detail: `${got.join(",")} != ${exp.join(",")}` };
    remaining.splice(idx, 1);
  }
  return { pass: true, detail: `matched ${exp.join(", ")}` };
}

function freeVars(node: MathNode): string[] {
  const names = new Set<string>();
  const fnNames = new Set<string>();
  node.filter((n) => n.type === "FunctionNode").forEach((n) => {
    const fn = (n as unknown as { fn?: { name?: string } }).fn;
    if (fn?.name) fnNames.add(fn.name);
  });
  node.filter((n) => n.type === "SymbolNode").forEach((n) => {
    const name = (n as unknown as { name: string }).name;
    const known = (math as unknown as Record<string, unknown>)[name];
    if (!fnNames.has(name) && typeof known !== "function" && !["e", "pi", "i"].includes(name)) names.add(name);
  });
  return [...names];
}

/** expression grading: equivalent if equal at ~samples random points. */
export function gradeExpression(model: string, expected: string, samples = 8, tol = 1e-9): GradeResult {
  let a: MathNode;
  let b: MathNode;
  try {
    a = math.parse(normalizeLatex(model));
    b = math.parse(normalizeLatex(expected));
  } catch (e) {
    return { pass: false, detail: `parse error: ${e instanceof Error ? e.message : String(e)}` };
  }
  const vars = [...new Set([...freeVars(a), ...freeVars(b)])];
  const ca = a.compile();
  const cb = b.compile();

  if (vars.length === 0) {
    // no variables → fall back to numeric comparison
    return gradeNumeric(model, expected, 1e-6);
  }

  let good = 0;
  for (let t = 0; t < samples * 6 && good < samples; t++) {
    const scope: Record<string, number> = {};
    for (const v of vars) scope[v] = (Math.random() * 2 - 1) * 7;
    let va: unknown;
    let vb: unknown;
    try {
      va = ca.evaluate(scope);
      vb = cb.evaluate(scope);
    } catch {
      continue; // domain error → resample
    }
    if (typeof va !== "number" || typeof vb !== "number" || !Number.isFinite(va) || !Number.isFinite(vb)) continue;
    if (Math.abs(va - vb) > tol * Math.max(1, Math.abs(vb))) {
      return { pass: false, detail: `differ at ${JSON.stringify(scope)}: ${va} vs ${vb}` };
    }
    good++;
  }
  if (good < samples) return { pass: false, detail: `only ${good}/${samples} valid sample points` };
  return { pass: true, detail: `equivalent at ${good} points (vars: ${vars.join(",")})` };
}

export function gradeAnswer(model: string, expected: string, type: ProblemType): GradeResult {
  if (!model.trim()) return { pass: false, detail: "empty model answer" };
  return type === "expression" ? gradeExpression(model, expected) : gradeNumeric(model, expected);
}

/**
 * Deterministic answer checker — the Evidence engine.
 *
 * Ground truth NEVER comes from Gemma. We verify the model's final answer against
 * an answer key (or an independent computation) by parsing both expressions and
 * evaluating them at several random sample points. We deliberately do NOT use
 * mathjs `simplify()` for equality — it is not a real CAS and gives false negatives.
 */

import { create, all, type MathNode, type FactoryFunctionMap } from "mathjs";

const math = create(all as FactoryFunctionMap, {});

export interface CheckResult {
  equal: boolean;
  variables: string[];
  pointsTested: Array<Record<string, number>>;
  reason?: string;
}

/** Names that resolve to functions/constants, not free variables. */
function isFreeVariable(name: string): boolean {
  const known = (math as unknown as Record<string, unknown>)[name];
  if (typeof known === "function") return false;
  if (["e", "pi", "i", "Infinity", "NaN", "true", "false"].includes(name)) return false;
  return true;
}

function freeVariables(node: MathNode): string[] {
  const names = new Set<string>();
  const fnNames = new Set<string>();
  // Callees of FunctionNode (e.g. `sin` in sin(x)) are not variables.
  node.filter((n) => n.type === "FunctionNode").forEach((n) => {
    const fn = (n as unknown as { fn?: { name?: string } }).fn;
    if (fn?.name) fnNames.add(fn.name);
  });
  node.filter((n) => n.type === "SymbolNode").forEach((n) => {
    const name = (n as unknown as { name: string }).name;
    if (!fnNames.has(name) && isFreeVariable(name)) names.add(name);
  });
  return [...names];
}

/** Strip a leading `y =` / `f(x) =` and normalize `**` → `^`. */
function normalize(src: string): string {
  const s = src.trim().replace(/\*\*/g, "^");
  const parts = s.split("=");
  return parts.length === 2 ? (parts[1] ?? s).trim() : s;
}

function isFiniteReal(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export interface CheckOpts {
  samples?: number;
  tol?: number;
  range?: number;
  maxTries?: number;
}

export function checkAnswer(exprRaw: string, expectedRaw: string, opts: CheckOpts = {}): CheckResult {
  const samples = opts.samples ?? 5;
  const tol = opts.tol ?? 1e-6;
  const range = opts.range ?? 10;
  const maxTries = opts.maxTries ?? 40;

  let a: MathNode;
  let b: MathNode;
  try {
    a = math.parse(normalize(exprRaw));
    b = math.parse(normalize(expectedRaw));
  } catch (e) {
    return { equal: false, variables: [], pointsTested: [], reason: `parse error: ${String(e)}` };
  }

  const vars = [...new Set([...freeVariables(a), ...freeVariables(b)])].sort();
  const ca = a.compile();
  const cb = b.compile();

  const relClose = (x: number, y: number) =>
    Math.abs(x - y) <= tol * (1 + Math.max(Math.abs(x), Math.abs(y)));

  // Pure-numeric answers (no variables).
  if (vars.length === 0) {
    try {
      const va: unknown = ca.evaluate({});
      const vb: unknown = cb.evaluate({});
      if (isFiniteReal(va) && isFiniteReal(vb)) {
        return { equal: relClose(va, vb), variables: [], pointsTested: [{}] };
      }
      const eq = math.equal(va as Parameters<typeof math.equal>[0], vb as Parameters<typeof math.equal>[1]);
      return { equal: eq === true, variables: [], pointsTested: [{}] };
    } catch (e) {
      return { equal: false, variables: [], pointsTested: [], reason: String(e) };
    }
  }

  // Symbolic: compare at random sample points.
  const tested: Array<Record<string, number>> = [];
  let good = 0;
  for (let t = 0; t < maxTries && good < samples; t++) {
    const scope: Record<string, number> = {};
    for (const v of vars) scope[v] = (Math.random() * 2 - 1) * range;

    let va: unknown;
    let vb: unknown;
    try {
      va = ca.evaluate(scope);
      vb = cb.evaluate(scope);
    } catch {
      continue; // domain error → resample
    }
    // Reject non-finite / complex (div-by-zero → Infinity, log(neg) → Complex).
    if (!isFiniteReal(va) || !isFiniteReal(vb)) continue;

    tested.push({ ...scope });
    if (!relClose(va, vb)) return { equal: false, variables: vars, pointsTested: tested };
    good++;
  }

  if (good < samples) {
    return {
      equal: false,
      variables: vars,
      pointsTested: tested,
      reason: `only ${good}/${samples} valid sample points found`,
    };
  }
  return { equal: true, variables: vars, pointsTested: tested };
}

/**
 * Compare a set of solutions (e.g. quadratic roots or a vertex point),
 * order-independent, each element checked via checkAnswer.
 */
export function checkSet(got: string[], expected: string[], opts: CheckOpts = {}): boolean {
  if (got.length !== expected.length) return false;
  const remaining = [...expected];
  for (const g of got) {
    const idx = remaining.findIndex((e) => checkAnswer(g, e, opts).equal);
    if (idx === -1) return false;
    remaining.splice(idx, 1);
  }
  return true;
}

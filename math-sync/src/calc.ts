/**
 * Calculator expression evaluator — shared by the `calculate` Gemma tool and
 * the /api/calculate endpoint behind the Calculator tab. One evaluation path
 * so the tool and the UI always agree.
 *
 * Contract: ALWAYS returns a string. Invalid input yields "Error: …" — this
 * must never throw into the agent loop.
 */

import { create, all, type FactoryFunctionMap } from "mathjs";

const math = create(all as FactoryFunctionMap, {});

// `precision: 14` collapses binary float noise (0.1+0.2 → "0.3") while keeping
// plenty of digits for real answers.
const FORMAT = { precision: 14 } as const;

export function calculateExpression(exprRaw: string): string {
  // Models (and students) often emit Python-style `**` for powers.
  const expr = exprRaw.trim().replace(/\*\*/g, "^");
  if (!expr) return "Error: empty expression";
  try {
    const value: unknown = math.evaluate(expr, {});
    if (value === undefined) return "Error: expression produced no value";
    if (typeof value === "function") {
      return "Error: that defines a function, not a value — pass a concrete expression like '2^3 + 1'";
    }
    // Guard non-finite results (Infinity / -Infinity / NaN, e.g. division by
    // zero) — "= Infinity" is misleading in a tutor; surface it as an error.
    if (typeof value === "number" && !Number.isFinite(value)) {
      return "Error: result is not a finite number (division by zero?)";
    }
    return math.format(value, FORMAT);
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Pure answer extraction for the eval — no I/O, no model calls.
 *
 * Why this exists: the first live eval run (Jul 18, gemma4:e2b) graded markdown
 * fragments — "**", "### Method", "$$m = \frac{8}{4}$$" — because extraction took
 * the raw last line of a markdown/LaTeX reply. This module:
 *
 *   1. prefers an explicit `ANSWER: <value>` line, scanned from the END of the
 *      reply (the prompt demands that line in both eval modes);
 *   2. normalizes markdown + LaTeX wrappers to plain mathjs-parseable text,
 *      mirroring gemma-course-tutor/src/grading/latex.ts (validated 22/22 there);
 *   3. falls back to the last line that cleans to parseable math with digits.
 *
 * Grading itself is untouched: src/checker.ts equality/tolerance stays as-is.
 */

import { create, all, type MathNode, type FactoryFunctionMap } from "mathjs";

const math = create(all as FactoryFunctionMap, {});

/** Names that are constants/keywords in mathjs, not free variables. */
const KNOWN_NAMES = new Set(["e", "pi", "i", "Infinity", "NaN", "true", "false"]);

/** Strip markdown + LaTeX wrappers, converting math commands to mathjs syntax. */
function stripWrappers(input: string): string {
  let s = input;

  // Markdown. Protect python-style power (2**3) before deleting bold markers.
  s = s.replace(/([0-9)])\s*\*\*\s*([0-9(])/g, "$1^$2");
  s = s.replace(/\*\*/g, "").replace(/__/g, "").replace(/`+/g, "");
  s = s.replace(/^\s*#{1,6}\s*/, "").replace(/^\s*[*+•]\s+/, "");

  // LaTeX delimiters and spacing.
  s = s.replace(/\$\$?/g, "").replace(/\\displaystyle/g, "");
  s = s.replace(/\\left|\\right/g, "");
  s = s.replace(/\\[,;!:>]/g, " ").replace(/\\quad|\\qquad/g, " ").replace(/~/g, " ");

  // \text{...} / \mathrm{...} → contents; \frac / \sqrt → mathjs (fixpoint loops
  // so nested forms resolve inside-out).
  for (let i = 0; i < 10; i++) {
    const next = s.replace(/\\(?:text|mathrm)\{([^{}]*)\}/g, "$1");
    if (next === s) break;
    s = next;
  }
  for (let i = 0; i < 10; i++) {
    const next = s.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, "(($1)/($2))");
    if (next === s) break;
    s = next;
  }
  for (let i = 0; i < 10; i++) {
    const next = s
      .replace(/\\sqrt\[([^\]]*)\]\{([^{}]*)\}/g, "nthRoot(($2),$1)")
      .replace(/\\sqrt\{([^{}]*)\}/g, "sqrt($1)");
    if (next === s) break;
    s = next;
  }

  // Symbols / operators.
  s = s
    .replace(/\\pi\b/g, "pi")
    .replace(/\\cdot|\\times/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\\pm/g, "±");

  // Superscripts/subscripts, then any leftover latex commands and stray braces.
  s = s.replace(/\^\{([^}]*)\}/g, "^($1)");
  s = s.replace(/_\{[^}]*\}/g, "").replace(/_[0-9a-zA-Z]/g, "");
  s = s.replace(/\\[a-zA-Z]+/g, " ").replace(/[{}]/g, " ");

  return s.replace(/\s+/g, " ").trim();
}

/** True if s is fully enclosed by one balanced (...) or [...] pair. */
function enclosed(s: string): boolean {
  const open = s.charAt(0);
  const close = open === "(" ? ")" : open === "[" ? "]" : "";
  if (!close || s.charAt(s.length - 1) !== close) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i === s.length - 1;
    }
  }
  return false;
}

/** Trim trailing punctuation and peel fully-enclosing parens/brackets. */
function stripOuter(input: string): string {
  let s = input.trim();
  for (let i = 0; i < 10; i++) {
    const before = s;
    s = s.replace(/[.,;:!?]+$/, "").trim();
    if (enclosed(s)) s = s.slice(1, -1).trim();
    if (s === before) break;
  }
  return s;
}

/** Split on commas/semicolons at paren depth 0 (so sqrt(2, ...) stays intact), then on or/and. */
function splitTop(s: string): string[] {
  const commaParts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) {
      commaParts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  commaParts.push(cur);
  return commaParts.flatMap((p) => p.split(/\bor\b|\band\b/i));
}

/**
 * Normalize one candidate answer value to bare comma-separated parts:
 * strip wrappers, take the value after the last "=" per part ("x = 3" → "3"),
 * peel enclosing parens ("(3, -4)" → "3, -4"), expand ± into both signs.
 */
function cleanValue(raw: string): string {
  const whole = stripOuter(stripWrappers(raw));
  const parts = splitTop(whole)
    .map((p) => {
      const eq = p.lastIndexOf("=");
      return eq === -1 ? p : p.slice(eq + 1);
    })
    .map((p) => stripOuter(p.trim()))
    .map((p) => p.replace(/\s+\([^()]*\)$/, "")) // drop a trailing " (aside)"
    .flatMap((p) => (p.includes("±") ? [p.replace("±", "+"), p.replace("±", "-")] : [p]))
    .map((p) => p.replace(/\s+/g, "").replace(/^\+/, ""))
    .filter(Boolean);
  return parts.join(", ");
}

/** True if mathjs parses it and every multi-letter symbol is a known constant/function. */
function isParseableMath(part: string): boolean {
  let node: MathNode;
  try {
    node = math.parse(part);
  } catch {
    return false;
  }
  const fnNames = new Set<string>();
  node.filter((n) => n.type === "FunctionNode").forEach((n) => {
    const fn = (n as unknown as { fn?: { name?: string } }).fn;
    if (fn?.name) fnNames.add(fn.name);
  });
  let ok = true;
  node.filter((n) => n.type === "SymbolNode").forEach((n) => {
    const name = (n as unknown as { name: string }).name;
    if (fnNames.has(name) || KNOWN_NAMES.has(name)) return;
    if (name.length > 1) ok = false; // prose word ("apples", "Method") — not math
  });
  return ok;
}

/**
 * Extract the model's final answer from a full reply.
 * Pass 1: last `ANSWER: <value>` line (markdown/LaTeX-tolerant).
 * Pass 2: last line that cleans to digit-bearing, parseable math.
 * Returns "" when nothing extractable exists — an honest fail, never "**".
 */
export function extractAnswer(text: string): string {
  const lines = text.split(/\r?\n/);

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    const m = stripWrappers(line).match(/\banswer\s*:\s*(.*)$/i);
    if (m?.[1] !== undefined) {
      const v = cleanValue(m[1]);
      if (v) return v;
    }
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    const v = cleanValue(line);
    if (!v || !/\d/.test(v)) continue;
    if (v.split(", ").every((p) => isParseableMath(p))) return v;
  }

  return "";
}

/** Grader validation against the real answer keys. Run: bun run src/grading/grade.test.ts */

import { resolve } from "node:path";
import { gradeAnswer, type ProblemType } from "./grade.ts";

interface Problem {
  id: string;
  question: string;
  expected: string;
  type: ProblemType;
}

const packDir = resolve(import.meta.dir, "../../course-pack");
const problems = (await Bun.file(resolve(packDir, "eval/problems.json")).json()) as Problem[];

let pass = 0;
let fail = 0;
const check = (name: string, got: boolean, want: boolean) => {
  const ok = got === want;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${got}, want ${want})`}`);
};

console.log("— self-consistency: each key must grade CORRECT against itself —");
for (const p of problems) {
  check(`${p.id} (${p.type}) self`, gradeAnswer(p.expected, p.expected, p.type).pass, true);
}

console.log("\n— realistic model-answer variants —");
check("p01 sqrt(61) form", gradeAnswer("sqrt(61)", "\\sqrt{61}", "numeric").pass, true);
check("p01 decimal 7.81", gradeAnswer("7.81", "\\sqrt{61}", "numeric").pass, false); // rounded ≠ exact
check("p02 fraction 5/6", gradeAnswer("5/6", "\\frac{5}{6}", "numeric").pass, true);
check("p03 325 pi spelled", gradeAnswer("325*pi", "325\\pi", "numeric").pass, true);
check("p04 roots reordered", gradeAnswer("x = 4, x = 6", "x = 6, \\; x = 4", "numeric").pass, true);
check("p05 slash form", gradeAnswer("(x-2)/(x+2)", "\\frac{x-2}{x+2}", "expression").pass, true);
check("p06 expanded poly", gradeAnswer("x^3 - 6x^2 + 11x - 6", "(x-2)(x-3)(x-1)", "expression").pass, true);
check("p07 log base", gradeAnswer("6", "6", "numeric").pass, true);
check("p09 binom value", gradeAnswer("combinations(12,4)", "495", "numeric").pass, true);

console.log("\n— must-fail (wrong answers) —");
check("p01 wrong 7", gradeAnswer("7", "\\sqrt{61}", "numeric").pass, false);
check("p06 wrong factor", gradeAnswer("(x-2)(x-3)", "(x-2)(x-3)(x-1)", "expression").pass, false);
check("p08 wrong sign", gradeAnswer("37", "-37", "numeric").pass, false);

console.log(`\n${fail === 0 ? "ALL GREEN" : "HAS FAILURES"}: ${pass} pass, ${fail} fail`);

/**
 * Evidence eval: run the course problem set two ways — raw Gemma vs Gemma + tools —
 * print a pass-rate table AND persist every result to eval/results.json (which the
 * app's Evidence tab reads). This is the "verifies rather than claims" proof.
 *
 *   bun run eval          # uses MATH_SYNC_MODEL (default gemma4:e4b)
 *
 * Ground truth = the answer key in problems.json (NEVER the model). Each model
 * answer is graded by the deterministic checker. Results are written after EVERY
 * problem so a long run is monitorable mid-flight and survives interruption; each
 * run is flipped to done:true only when it finishes. New runs are APPENDED — the
 * committed baseline and prior runs are never clobbered.
 */

import { resolve } from "node:path";
import { streamChat, MODEL, type OllamaMessage } from "../src/ollama.ts";
import { toolSchemas } from "../src/tools.ts";
import { checkAnswer, checkSet } from "../src/checker.ts";
import {
  defaultResultsPath,
  upsertRun,
  type ProblemResult,
  type Run,
} from "./results.ts";

interface Problem {
  id: string;
  prompt: string;
  type: "numeric" | "expression" | "roots" | "point";
  answer: string | string[];
}

/** Collect the full (non-streamed-for-us) text of one model turn. */
async function ask(prompt: string, withTools: boolean): Promise<string> {
  const messages: OllamaMessage[] = [
    {
      role: "system",
      content: withTools
        ? "You are a math tutor. Use tools to verify. End your reply with a line: ANSWER: <final answer only>."
        : "You are a math tutor. End your reply with a line: ANSWER: <final answer only>.",
    },
    { role: "user", content: prompt },
  ];
  let text = "";
  for await (const chunk of streamChat({
    messages,
    tools: withTools ? toolSchemas : undefined,
    options: { temperature: 0, num_predict: 512 },
  })) {
    if (chunk.message?.content) text += chunk.message.content;
  }
  return text;
}

/** Pull the answer out of an "ANSWER: ..." line, else use the last non-empty line. */
function extractAnswer(text: string): string {
  const m = text.match(/ANSWER:\s*(.+)\s*$/im);
  if (m?.[1]) return m[1].trim();
  const lines = text.trim().split("\n").filter((l) => l.trim());
  return lines[lines.length - 1]?.trim() ?? "";
}

function grade(got: string, p: Problem): boolean {
  // Split multi-part answers on commas / "or" / "and".
  const parts = got.split(/,|\bor\b|\band\b/i).map((s) => s.replace(/^[a-z]\s*=\s*/i, "").trim()).filter(Boolean);
  if (Array.isArray(p.answer)) return checkSet(parts, p.answer);
  return checkAnswer(parts[0] ?? got, p.answer).equal;
}

const glyph = (ok: boolean): string => (ok ? "✓" : "✗"); // ✓ / ✗

/**
 * Run one mode (raw or +tools) over every problem, writing results.json after each
 * problem and marking the run done at the end. Returns the count that passed.
 */
async function runMode(
  problems: Problem[],
  mode: "raw" | "tools",
  path: string,
): Promise<number> {
  const run: Run = {
    name: mode === "raw" ? `Raw Gemma (${MODEL})` : `Gemma + tools (${MODEL})`,
    model: MODEL,
    mode,
    startedAt: new Date().toISOString(),
    done: false,
    problems: [],
    passRate: "0/0",
    avgSeconds: null,
  };
  await upsertRun(path, run); // register the run immediately (monitorable mid-flight)

  let passed = 0;
  for (const p of problems) {
    const t0 = performance.now();
    const got = extractAnswer(await ask(p.prompt, mode === "tools"));
    const seconds = Math.round(((performance.now() - t0) / 1000) * 100) / 100;
    const pass = grade(got, p);
    if (pass) passed++;

    const result: ProblemResult = { id: p.id, question: p.prompt, expected: p.answer, got, pass, seconds };
    run.problems.push(result);
    await upsertRun(path, run); // incremental persist after every problem

    console.log(`  ${p.id.padEnd(10)} ${mode === "raw" ? "raw" : "+tools"} ${glyph(pass)}  ${seconds}s`);
  }

  run.done = true;
  await upsertRun(path, run);
  return passed;
}

async function main(): Promise<void> {
  const file = Bun.file(resolve(import.meta.dir, "problems.json"));
  const { problems } = (await file.json()) as { problems: Problem[] };
  const path = defaultResultsPath();
  console.log(`Evaluating ${problems.length} problems on ${MODEL} (raw vs +tools)...`);
  console.log(`Writing results to ${path}\n`);

  const rawPass = await runMode(problems, "raw", path);
  const toolPass = await runMode(problems, "tools", path);

  const n = problems.length;
  console.log("\n─────────────────────────────");
  console.log(`Raw Gemma:    ${rawPass}/${n}  (${Math.round((100 * rawPass) / n)}%)`);
  console.log(`Gemma+tools:  ${toolPass}/${n}  (${Math.round((100 * toolPass) / n)}%)`);
  console.log("─────────────────────────────");
}

main().catch((e) => {
  console.error("Eval failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

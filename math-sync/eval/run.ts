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
import { streamChat, MODEL, type OllamaMessage, type ToolCall } from "../src/ollama.ts";
import { toolSchemas, dispatchTool, type ToolContext } from "../src/tools.ts";
import { checkAnswer, checkSet } from "../src/checker.ts";
import { loadCourse, type CoursePack } from "../src/course.ts";
import { extractAnswer } from "./extract.ts";
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

/** Same tool-round cap as src/agent.ts. */
const MAX_ROUNDS = 5;

/** Machine-gradeable output contract, mirroring gemma-course-tutor's proven prompt. */
const ANSWER_RULE =
  "Show your key steps briefly, in plain text only — no markdown, no LaTeX. " +
  "The LAST line of your reply MUST be exactly `ANSWER: <value>` with only the final " +
  "value in plain form (e.g. `ANSWER: 3`, `ANSWER: sqrt(2)`), comma-separated when " +
  "there are multiple solutions or coordinates (e.g. `ANSWER: 2, 3`).";

/** One streamed model turn: accumulate text + any tool calls (as src/agent.ts does). */
async function turn(
  messages: OllamaMessage[],
  withTools: boolean,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  let text = "";
  const toolCalls: ToolCall[] = [];
  for await (const chunk of streamChat({
    messages,
    tools: withTools ? toolSchemas : undefined,
    options: { temperature: 0, num_predict: 1024 },
  })) {
    const m = chunk.message;
    if (m?.content) text += m.content;
    if (m?.tool_calls?.length) toolCalls.push(...m.tool_calls);
  }
  return { text, toolCalls };
}

/**
 * Ask one problem. Raw mode = single turn. Tools mode = the agent-style loop:
 * dispatch every tool call and feed results back (the first live run dropped
 * tool calls on the floor, so "with tools" never actually ran a tool), capped
 * at MAX_ROUNDS, with src/agent.ts's empty-final-answer guard (one retry).
 */
async function ask(prompt: string, withTools: boolean, course: CoursePack): Promise<string> {
  const messages: OllamaMessage[] = [
    {
      role: "system",
      content: withTools
        ? `You are a math tutor solving one problem. Use tools to verify your final answer before stating it. ${ANSWER_RULE}`
        : `You are a math tutor solving one problem. ${ANSWER_RULE}`,
    },
    { role: "user", content: prompt },
  ];

  if (!withTools) {
    const { text } = await turn(messages, false);
    return text;
  }

  const ctx: ToolContext = { course, plots: [] };
  let lastText = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { text, toolCalls } = await turn(messages, true);
    if (text.trim()) lastText = text;
    if (toolCalls.length === 0) break;
    messages.push({ role: "assistant", content: text, tool_calls: toolCalls });
    for (const call of toolCalls) {
      const result = dispatchTool(call.function.name, call.function.arguments ?? {}, ctx);
      messages.push({ role: "tool", tool_name: call.function.name, content: result });
    }
  }

  // Never record an empty `got` without one retry (small-Gemma post-tool quirk).
  if (extractAnswer(lastText) === "") {
    messages.push({
      role: "system",
      content: "State the final answer now as a single line: ANSWER: <value>",
    });
    const retry = await turn(messages, true);
    if (retry.text.trim()) return retry.text;
  }
  return lastText;
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
  course: CoursePack,
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
    const got = extractAnswer(await ask(p.prompt, mode === "tools", course));
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
  const course = await loadCourse(); // lookup_course context for tools mode
  console.log(`Evaluating ${problems.length} problems on ${MODEL} (raw vs +tools)...`);
  console.log(`Tools context: course at ${course.dir} (${course.lessons.length} lessons)`);
  console.log(`Writing results to ${path}\n`);

  const rawPass = await runMode(problems, "raw", path, course);
  const toolPass = await runMode(problems, "tools", path, course);

  const n = problems.length;
  console.log("\n─────────────────────────────");
  console.log(`Raw Gemma:    ${rawPass}/${n}  (${Math.round((100 * rawPass) / n)}%)`);
  console.log(`Gemma+tools:  ${toolPass}/${n}  (${Math.round((100 * toolPass) / n)}%)`);
  console.log("─────────────────────────────");
}

// Only run when invoked directly (`bun run eval`) — keeps `ask` importable for
// smoke checks without kicking off a full eval.
if (import.meta.main) {
  main().catch((e) => {
    console.error("Eval failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

export { ask };

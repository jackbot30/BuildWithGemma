/**
 * Evidence eval: run the course problem set two ways — raw Gemma vs Gemma + tools —
 * and print a pass-rate table. This is the "verifies rather than claims" proof.
 *
 *   bun run eval          # uses MATH_SYNC_MODEL (default gemma4:e4b)
 *
 * Ground truth = the answer key in problems.json (NEVER the model). Each model
 * answer is graded by the deterministic checker.
 */

import { resolve } from "node:path";
import { streamChat, MODEL, type OllamaMessage } from "../src/ollama.ts";
import { toolSchemas } from "../src/tools.ts";
import { checkAnswer, checkSet } from "../src/checker.ts";

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

async function main(): Promise<void> {
  const file = Bun.file(resolve(import.meta.dir, "problems.json"));
  const { problems } = (await file.json()) as { problems: Problem[] };
  console.log(`Evaluating ${problems.length} problems on ${MODEL} (raw vs +tools)...\n`);

  const rows: Array<{ id: string; raw: string; tools: string }> = [];
  let rawPass = 0;
  let toolPass = 0;

  for (const p of problems) {
    const rawOk = grade(extractAnswer(await ask(p.prompt, false)), p);
    const toolOk = grade(extractAnswer(await ask(p.prompt, true)), p);
    if (rawOk) rawPass++;
    if (toolOk) toolPass++;
    rows.push({ id: p.id, raw: rawOk ? "✓" : "✗", tools: toolOk ? "✓" : "✗" });
    console.log(`  ${p.id.padEnd(10)} raw ${rawOk ? "✓" : "✗"}   +tools ${toolOk ? "✓" : "✗"}`);
  }

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

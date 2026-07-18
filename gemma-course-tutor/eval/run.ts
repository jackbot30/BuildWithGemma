/**
 * Two-mode eval harness for the local RAG study tutor.
 *
 * For each problem in course-pack/eval/problems.json we ask the local Gemma model
 * to solve it twice — once CLOSED-BOOK (question only) and once OPEN-BOOK (top-k
 * retrieved course context prepended) — then grade both answers against the
 * ground-truth key with the shared grading module. We report per-mode accuracy so
 * we can see whether retrieval actually helps.
 *
 * Everything is local (Ollama). Run with:  bun run eval [label]
 * Results are written to eval-results/results-<label>.json (gitignored).
 */

import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadConfig } from "../src/config.ts";
import { chat, checkOllama, type ChatMessage } from "../src/ollama.ts";
import { retrieve, formatContext } from "../src/rag/retrieve.ts";
import { gradeAnswer, type ProblemType } from "../src/grading/grade.ts";

interface Problem {
  id: string;
  question: string;
  expected: string;
  type: ProblemType;
}

type Mode = "closed" | "open";

interface ResultRow {
  id: string;
  mode: Mode;
  question: string;
  modelAnswer: string;
  expected: string;
  pass: boolean;
  detail: string;
  parseWarning: boolean;
}

interface ModeAccuracy {
  pass: number;
  total: number;
  percent: number;
}

interface Report {
  label: string;
  model: string;
  generatedAt: string;
  results: ResultRow[];
  accuracy: Record<Mode, ModeAccuracy>;
}

const SYSTEM_PROMPT = [
  "You are a careful math tutor solving a single problem.",
  "Work through it, then output your final answer.",
  "The LAST line of your reply MUST be exactly `ANSWER: <value>` where <value> is",
  "only the final value/expression — no words, no units, no explanation after it.",
  "Give the value in plain form (e.g. `sqrt(61)`, `325*pi`, `5/6`, `x = 6, x = 4`).",
].join(" ");

/** Extract the model's final answer. Returns the parsed value and whether we had
 *  to fall back (no `ANSWER:` line found). */
function parseAnswer(reply: string): { answer: string; parseWarning: boolean } {
  const lines = reply.split(/\r?\n/);
  // Find the LAST line containing an `ANSWER:` marker (case-insensitive).
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    const m = line.match(/answer\s*:\s*(.*)$/i);
    if (m && m[1] !== undefined) {
      const answer = m[1].trim();
      if (answer) return { answer, parseWarning: false };
    }
  }
  // Fallback: last non-empty line, flagged.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line !== undefined && line.trim()) {
      return { answer: line.trim(), parseWarning: true };
    }
  }
  return { answer: "", parseWarning: true };
}

/** Build the chat messages for a given mode. Open-book prepends retrieved context. */
async function buildMessages(problem: Problem, mode: Mode, k: number): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
  if (mode === "open") {
    const hits = await retrieve(problem.question, k); // may throw if no index
    const context = formatContext(hits);
    messages.push({
      role: "user",
      content:
        "Use the following course excerpts if they are relevant. Cite nothing; just solve.\n\n" +
        `${context}\n\n---\n\nProblem: ${problem.question}`,
    });
  } else {
    messages.push({ role: "user", content: `Problem: ${problem.question}` });
  }
  return messages;
}

/** Run one problem in one mode, grade it, and return a row. Never throws — any
 *  failure is recorded as a failed row with the error in `detail`. */
async function runOne(problem: Problem, mode: Mode, k: number): Promise<ResultRow> {
  let modelAnswer = "";
  let parseWarning = false;
  try {
    const messages = await buildMessages(problem, mode, k);
    const reply = await chat(messages, { temperature: 0 });
    const parsed = parseAnswer(reply);
    modelAnswer = parsed.answer;
    parseWarning = parsed.parseWarning;
  } catch (e) {
    return {
      id: problem.id,
      mode,
      question: problem.question,
      modelAnswer,
      expected: problem.expected,
      pass: false,
      detail: `model call failed: ${e instanceof Error ? e.message : String(e)}`,
      parseWarning: true,
    };
  }

  let pass = false;
  let detail: string;
  try {
    const graded = gradeAnswer(modelAnswer, problem.expected, problem.type);
    pass = graded.pass;
    detail = graded.detail;
  } catch (e) {
    detail = `grading failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  return {
    id: problem.id,
    mode,
    question: problem.question,
    modelAnswer,
    expected: problem.expected,
    pass,
    detail,
    parseWarning,
  };
}

function accuracyFor(rows: ResultRow[], mode: Mode): ModeAccuracy {
  const forMode = rows.filter((r) => r.mode === mode);
  const pass = forMode.filter((r) => r.pass).length;
  const total = forMode.length;
  const percent = total === 0 ? 0 : Math.round((pass / total) * 1000) / 10;
  return { pass, total, percent };
}

/** Detect whether an open-book failure is due to a missing store index, so we can
 *  give the user the actionable hint rather than a raw stack trace. */
function isMissingIndex(row: ResultRow): boolean {
  return /run `?bun run index`?|No index at/i.test(row.detail);
}

function printTable(report: Report): void {
  const mark = (row: ResultRow | undefined): string => {
    if (!row) return "  ? ";
    const symbol = row.pass ? "✓" : "✗";
    return row.parseWarning ? ` ${symbol}! ` : ` ${symbol}  `;
  };

  const byId = new Map<string, { closed?: ResultRow; open?: ResultRow }>();
  for (const r of report.results) {
    const entry = byId.get(r.id) ?? {};
    entry[r.mode] = r;
    byId.set(r.id, entry);
  }

  console.log("");
  console.log(`Eval: ${report.label}   model: ${report.model}`);
  console.log("┌────────┬──────────┬──────────┐");
  console.log("│ id     │ closed   │ open     │");
  console.log("├────────┼──────────┼──────────┤");
  for (const [id, entry] of byId) {
    console.log(`│ ${id.padEnd(6)} │  ${mark(entry.closed).padEnd(7)}│  ${mark(entry.open).padEnd(7)}│`);
  }
  console.log("└────────┴──────────┴──────────┘");
  console.log("(✓ pass  ✗ fail  ! answer-parse fallback used)");
  console.log("");
  const c = report.accuracy.closed;
  const o = report.accuracy.open;
  console.log(`closed-book accuracy: ${c.pass}/${c.total}  (${c.percent}%)`);
  console.log(`open-book   accuracy: ${o.pass}/${o.total}  (${o.percent}%)`);
  console.log("");
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const label = process.argv[2] ?? "run";

  // 1. Model reachability.
  const health = await checkOllama(cfg.gemmaModel);
  if (!health.ok) {
    console.error(`Ollama/model not ready: ${health.reason ?? "unknown"}`);
    console.error(`Hint: start Ollama and run  \`ollama pull ${cfg.gemmaModel}\``);
    process.exit(1);
  }

  // Load problems from the course pack.
  const problemsPath = resolve(cfg.coursePackDir, "eval/problems.json");
  const problems = (await Bun.file(problemsPath).json()) as Problem[];
  if (!problems.length) {
    console.error(`No problems found in ${problemsPath}`);
    process.exit(1);
  }

  // 2/3/4. Run both modes for every problem. Run closed-book first; the first
  // open-book call is where a missing index surfaces — check it once, up front,
  // so we can fail fast with a clear message instead of 10 identical errors.
  try {
    await retrieve(problems[0]?.question ?? "warmup", cfg.topK);
  } catch (e) {
    console.error(`Retrieval failed — the vector index is not ready.`);
    console.error(`Details: ${e instanceof Error ? e.message : String(e)}`);
    console.error("Run `bun run index` first to build ./store/index.json, then re-run the eval.");
    process.exit(1);
  }

  const results: ResultRow[] = [];
  for (const problem of problems) {
    process.stderr.write(`• ${problem.id} closed…`);
    const closed = await runOne(problem, "closed", cfg.topK);
    results.push(closed);
    process.stderr.write(` ${closed.pass ? "✓" : "✗"}  open…`);
    const open = await runOne(problem, "open", cfg.topK);
    results.push(open);
    process.stderr.write(` ${open.pass ? "✓" : "✗"}\n`);

    // If open-book failed specifically because the index vanished mid-run, stop
    // with the actionable hint rather than churning through the rest.
    if (isMissingIndex(open)) {
      console.error("\nThe vector index is missing. Run `bun run index` first, then re-run the eval.");
      process.exit(1);
    }
  }

  // 5. Assemble the report.
  const report: Report = {
    label,
    model: cfg.gemmaModel,
    generatedAt: new Date().toISOString(),
    results,
    accuracy: {
      closed: accuracyFor(results, "closed"),
      open: accuracyFor(results, "open"),
    },
  };

  // 6. Persist + print.
  const outDir = resolve(process.cwd(), "eval-results");
  await mkdir(outDir, { recursive: true });
  const outPath = resolve(outDir, `results-${label}.json`);
  await Bun.write(outPath, `${JSON.stringify(report, null, 2)}\n`);

  printTable(report);
  console.log(`Full report written to ${outPath}`);
}

main().catch((e) => {
  console.error(`Eval harness crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});

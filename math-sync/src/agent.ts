/**
 * The tutoring agent loop. Streams Gemma's reply, dispatches tool calls, feeds
 * results back, and repeats (capped). Emits typed events so server.ts can forward
 * them to the client over SSE — stream EVERYTHING so the screen is never frozen.
 *
 * Every turn also feeds a TraceBuilder (src/trace.ts) so we can show judges
 * exactly what the model did: tool calls, timings, verdicts, tok/s.
 */

import { streamChat, MODEL, type OllamaMessage, type ToolCall } from "./ollama.ts";
import type { CoursePack } from "./course.ts";
import { toolSchemas, dispatchTool, type ToolContext, type PlotSpec } from "./tools.ts";
import type { QuizClientView } from "./quiz.ts"; // feat/quiz
import { TraceBuilder, recordTrace, type TurnTrace, type TraceOutcome } from "./trace.ts";

export type AgentEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; phase: "call" | "result"; detail: string; durationMs?: number }
  | { type: "plot"; spec: PlotSpec }
  | { type: "quiz"; quiz: QuizClientView } // feat/quiz — no expected answers, ever
  | { type: "done"; text: string }
  | { type: "trace"; trace: TurnTrace }
  | { type: "error"; message: string };

const MAX_ROUNDS = 5;
// Test knob only: lets smoke tests cap generation cheaply on a shared CPU.
// Unset (the normal case, incl. prod/demo) keeps the shipped default of 1024.
const NUM_PREDICT = Number(process.env.MATH_SYNC_NUM_PREDICT ?? "") || 1024;

function systemPrompt(course: CoursePack): string {
  const lessons = course.lessons.map((l) => l.title).join("; ");
  return [
    "You are Math Sync, an offline math tutor for THIS course only.",
    `Loaded course lessons: ${lessons || "(none)"}.`,
    "Rules (in priority order):",
    "1. ONLY answer from the loaded course. If asked something outside this course, say it's outside this course — do not guess.",
    "2. ALWAYS call lookup_course before answering any math question — never answer from memory.",
    "3. After solving any equation, call verify_solution with the ORIGINAL equation string and your solutions before stating them to the student.",
    "4. Call calculate for any arithmetic — never do mental math.",
    "5. Call check_answer only when you have a course-sourced answer key value (from lookup_course or the quiz/eval key). Never call it with your own computed answer as expected — that is circular.",
    "6. Call plot when a graph helps understanding (parabolas, lines, etc.).",
    "7. When creating a quiz, never state the answers in your text — only call create_quiz.",
    "8. Be concise. Plain text. LaTeX $...$ ok for math.",
  ].join("\n");
}

/** One streamed model turn: accumulate text + any tool calls (traced as a round). */
async function runTurn(
  messages: OllamaMessage[],
  emit: (e: AgentEvent) => void,
  trace: TraceBuilder,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  let text = "";
  const toolCalls: ToolCall[] = [];
  let evalCount: number | undefined;
  let evalDurationNs: number | undefined;
  trace.startRound();
  try {
    for await (const chunk of streamChat({
      messages,
      tools: toolSchemas,
      options: { temperature: 0.1, num_predict: NUM_PREDICT },
    })) {
      const m = chunk.message;
      if (m?.content) {
        text += m.content;
        emit({ type: "delta", text: m.content });
      }
      if (m?.tool_calls?.length) toolCalls.push(...m.tool_calls);
      if (chunk.done) {
        evalCount = chunk.eval_count;
        evalDurationNs = chunk.eval_duration;
      }
    }
  } finally {
    trace.endRound({ evalCount, evalDurationNs });
  }
  return { text, toolCalls };
}

/** Finalize the trace, persist it, and stream it to the client. */
function finishTrace(
  trace: TraceBuilder,
  outcome: TraceOutcome,
  emit: (e: AgentEvent) => void,
  error?: string,
): void {
  const turn = trace.finish(outcome, error);
  recordTrace(turn);
  emit({ type: "trace", trace: turn });
}

export async function runAgent(
  history: OllamaMessage[],
  userInput: string,
  course: CoursePack,
  emit: (e: AgentEvent) => void,
): Promise<void> {
  const ctx: ToolContext = { course, plots: [], quizzes: [] }; // feat/quiz: quizzes
  const system = systemPrompt(course);
  const messages: OllamaMessage[] = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: userInput },
  ];
  const trace = new TraceBuilder({
    model: MODEL,
    systemPromptChars: system.length,
    userInput,
  });

  let lastText = "";
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { text, toolCalls } = await runTurn(messages, emit, trace);
      if (text.trim()) lastText = text;

      if (toolCalls.length === 0) {
        // Guard the small-Gemma "empty final answer after a tool round" quirk.
        if (text.trim() !== "") {
          emit({ type: "done", text });
          finishTrace(trace, "answered", emit);
          return;
        }
        messages.push({ role: "system", content: "State the final answer to the student in plain text now." });
        const retry = await runTurn(messages, emit, trace);
        emit({ type: "done", text: retry.text.trim() || "(no answer produced)" });
        finishTrace(trace, "retry-answered", emit);
        return;
      }

      messages.push({ role: "assistant", content: text, tool_calls: toolCalls });
      for (const call of toolCalls) {
        const name = call.function.name;
        const args = call.function.arguments ?? {};
        emit({ type: "tool", name, phase: "call", detail: JSON.stringify(args) });
        const t0 = Date.now();
        const result = dispatchTool(name, args, ctx);
        const durationMs = Date.now() - t0;
        trace.addToolCall(name, args, result, durationMs);
        emit({ type: "tool", name, phase: "result", detail: result, durationMs });
        messages.push({ role: "tool", tool_name: name, content: result });
      }
      // Emit any graphs this round produced.
      for (const spec of ctx.plots.splice(0)) emit({ type: "plot", spec });
      // feat/quiz: emit any quizzes this round produced (questions only — no answer key).
      for (const quiz of (ctx.quizzes ?? []).splice(0)) emit({ type: "quiz", quiz });
    }
    // Hit the round cap — fall back to the best answer text we streamed, since
    // small Gemma often emits its final prose alongside one last tool call.
    emit({ type: "done", text: lastText.trim() || "Reached the tool-round limit without a final answer." });
    finishTrace(trace, "round-cap", emit);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message });
    finishTrace(trace, "error", emit, message);
  }
}

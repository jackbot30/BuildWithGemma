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
import { TraceBuilder, recordTrace, type TurnTrace, type TraceOutcome } from "./trace.ts";

export type AgentEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; phase: "call" | "result"; detail: string; durationMs?: number }
  | { type: "plot"; spec: PlotSpec }
  | { type: "done"; text: string }
  | { type: "trace"; trace: TurnTrace }
  | { type: "error"; message: string; detail?: string };

const MAX_ROUNDS = 5;
// Test knob only: lets smoke tests cap generation cheaply on a shared CPU.
// Unset (the normal case, incl. prod/demo) keeps the shipped default of 1024.
const NUM_PREDICT = Number(process.env.MATH_SYNC_NUM_PREDICT ?? "") || 1024;

function systemPrompt(course: CoursePack): string {
  const lessons = course.lessons.map((l) => l.title).join("; ");
  return [
    "You are Math Sync, an offline math tutor for THIS course only.",
    `Loaded course lessons: ${lessons || "(none)"}.`,
    "Rules:",
    "- Ground every explanation in the course. Call lookup_course before answering.",
    "- Call check_answer on every final numeric/algebraic answer before stating it.",
    "- Call plot when a graph aids understanding.",
    "- Call calculate for any arithmetic — never do mental math.",
    "- If asked something outside this course, say it's outside the course — do not guess.",
    "- Be concise. Show key steps, then the final answer.",
  ].join("\n");
}

/** One streamed model turn: accumulate text + any tool calls (traced as a round). */
async function runTurn(
  messages: OllamaMessage[],
  emit: (e: AgentEvent) => void,
  trace: TraceBuilder,
  opts: { withTools?: boolean } = {},
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const withTools = opts.withTools ?? true;
  let text = "";
  const toolCalls: ToolCall[] = [];
  let evalCount: number | undefined;
  let evalDurationNs: number | undefined;
  trace.startRound();
  try {
    for await (const chunk of streamChat({
      messages,
      // The empty-answer retry runs WITHOUT tool schemas: we only want plain
      // prose here, and offering tools invites another zombie tool round.
      ...(withTools ? { tools: toolSchemas } : {}),
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
  /**
   * What to record in the trace as the student's question. When a lesson is
   * open, `userInput` is a lesson-prefixed blob sent to the model; pass the raw
   * student message here so the Trace tab shows the real question. Defaults to
   * `userInput` when the two are the same.
   */
  displayInput?: string,
): Promise<void> {
  const ctx: ToolContext = { course, plots: [] };
  const system = systemPrompt(course);
  const messages: OllamaMessage[] = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: userInput },
  ];
  const trace = new TraceBuilder({
    model: MODEL,
    systemPromptChars: system.length,
    userInput: displayInput ?? userInput,
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
        const retry = await runTurn(messages, emit, trace, { withTools: false });
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
    }
    // Hit the round cap — fall back to the best answer text we streamed, since
    // small Gemma often emits its final prose alongside one last tool call.
    emit({ type: "done", text: lastText.trim() || "Reached the tool-round limit without a final answer." });
    finishTrace(trace, "round-cap", emit);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // A model-down failure (Ollama offline / connection refused) is the most
    // likely error on the demo machine — translate it into a friendly, actionable
    // message and keep the raw text in `detail` for the trace/debugging.
    const modelDown = /ollama|fetch failed|failed to fetch|ECONNREFUSED|econnrefused|connect/i.test(raw);
    const message = modelDown
      ? "The on-device model isn't responding — make sure Ollama is running (ollama serve) and the model is pulled."
      : raw;
    emit(modelDown ? { type: "error", message, detail: raw } : { type: "error", message });
    finishTrace(trace, "error", emit, raw);
  }
}

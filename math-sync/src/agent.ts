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
import { chatToolSchemas, dispatchTool, type ToolContext, type PlotSpec } from "./tools.ts";
import type { QuizClientView } from "./quiz.ts"; // feat/quiz
import type { FlashcardDeck } from "./flashcards.ts"; // feat/flashcards
import { TraceBuilder, recordTrace, type TurnTrace, type TraceOutcome } from "./trace.ts";

export type AgentEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; phase: "call" | "result"; detail: string; durationMs?: number }
  | { type: "plot"; spec: PlotSpec }
  | { type: "quiz"; quiz: QuizClientView } // feat/quiz — no expected answers, ever
  | { type: "flashcards"; deck: FlashcardDeck } // feat/flashcards
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
    "Rules (in priority order):",
    "1. ONLY answer from the loaded course. If asked something outside this course, say it's outside this course — do not guess.",
    "2. ALWAYS call lookup_course before answering any math question — never answer from memory.",
    "3. After solving any equation, call verify_solution with the ORIGINAL equation string and your solutions before stating them to the student.",
    "4. Call calculate for any arithmetic — never do mental math.",
    "5. verify_solution is your only checker in chat — never claim an answer is verified unless it returned VERIFIED.",
    "6. Call plot when a graph helps understanding (parabolas, lines, etc.).",
    "7. When asked for a quiz call create_quiz; when asked for flashcards call create_flashcards (front/back drawn from the lesson). Never state quiz answers in your text.",
    "8. Be concise. Plain text. LaTeX $...$ ok for math.",
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
      ...(withTools ? { tools: chatToolSchemas } : {}),
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
  /**
   * feat/flashcards: a tool the model MUST call this turn (e.g. create_flashcards
   * when the student asked for flashcards). If the loop would finish without it,
   * we inject a firm instruction and grant one extra round — small Gemma sometimes
   * writes the cards in prose instead of calling the tool.
   */
  requiredTool?: string,
): Promise<void> {
  const ctx: ToolContext = { course, plots: [], quizzes: [], flashcards: [] }; // feat/quiz + feat/flashcards
  const calledTools = new Set<string>();
  let requiredRetryUsed = false;
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
        // feat/flashcards: enforce the required tool before accepting a final answer.
        if (requiredTool && !calledTools.has(requiredTool) && !requiredRetryUsed) {
          requiredRetryUsed = true;
          messages.push({ role: "assistant", content: text });
          messages.push({
            role: "system",
            content: `You did not call the ${requiredTool} tool. Call ${requiredTool} NOW with content drawn from the course material above. Do not write the content in prose.`,
          });
          continue;
        }
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
        calledTools.add(name);
        const args = call.function.arguments ?? {};
        emit({ type: "tool", name, phase: "call", detail: JSON.stringify(args) });
        const t0 = Date.now();
        // Defense in depth: check_answer is not in chatToolSchemas, but if the model
        // hallucinates the call anyway, redirect instead of running a circular check.
        const result =
          name === "check_answer"
            ? "Error: check_answer is not available in chat — call verify_solution with the original equation and your solutions instead."
            : dispatchTool(name, args, ctx);
        const durationMs = Date.now() - t0;
        trace.addToolCall(name, args, result, durationMs);
        emit({ type: "tool", name, phase: "result", detail: result, durationMs });
        messages.push({ role: "tool", tool_name: name, content: result });
      }
      // Emit any graphs this round produced.
      for (const spec of ctx.plots.splice(0)) emit({ type: "plot", spec });
      // feat/quiz: emit any quizzes this round produced (questions only — no answer key).
      for (const quiz of (ctx.quizzes ?? []).splice(0)) emit({ type: "quiz", quiz });
      // feat/flashcards: emit any decks this round produced.
      for (const deck of (ctx.flashcards ?? []).splice(0)) emit({ type: "flashcards", deck });
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

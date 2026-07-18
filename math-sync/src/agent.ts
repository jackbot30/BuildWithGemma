/**
 * The tutoring agent loop. Streams Gemma's reply, dispatches tool calls, feeds
 * results back, and repeats (capped). Emits typed events so server.ts can forward
 * them to the client over SSE — stream EVERYTHING so the screen is never frozen.
 */

import { streamChat, type OllamaMessage, type ToolCall } from "./ollama.ts";
import type { CoursePack } from "./course.ts";
import { toolSchemas, dispatchTool, type ToolContext, type PlotSpec } from "./tools.ts";

export type AgentEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; phase: "call" | "result"; detail: string }
  | { type: "plot"; spec: PlotSpec }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

const MAX_ROUNDS = 5;

function systemPrompt(course: CoursePack): string {
  const lessons = course.lessons.map((l) => l.title).join("; ");
  return [
    "You are Math Sync, an offline math tutor for THIS course only.",
    `Loaded course lessons: ${lessons || "(none)"}.`,
    "Rules:",
    "- Ground every explanation in the course. Call lookup_course before answering.",
    "- Call check_answer on every final numeric/algebraic answer before stating it.",
    "- Call plot when a graph aids understanding.",
    "- If asked something outside this course, say it's outside the course — do not guess.",
    "- Be concise. Show key steps, then the final answer.",
  ].join("\n");
}

/** One streamed model turn: accumulate text + any tool calls. */
async function runTurn(
  messages: OllamaMessage[],
  emit: (e: AgentEvent) => void,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  let text = "";
  const toolCalls: ToolCall[] = [];
  for await (const chunk of streamChat({
    messages,
    tools: toolSchemas,
    options: { temperature: 0.1, num_predict: 1024 },
  })) {
    const m = chunk.message;
    if (m?.content) {
      text += m.content;
      emit({ type: "delta", text: m.content });
    }
    if (m?.tool_calls?.length) toolCalls.push(...m.tool_calls);
  }
  return { text, toolCalls };
}

export async function runAgent(
  history: OllamaMessage[],
  userInput: string,
  course: CoursePack,
  emit: (e: AgentEvent) => void,
): Promise<void> {
  const ctx: ToolContext = { course, plots: [] };
  const messages: OllamaMessage[] = [
    { role: "system", content: systemPrompt(course) },
    ...history,
    { role: "user", content: userInput },
  ];

  let lastText = "";
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { text, toolCalls } = await runTurn(messages, emit);
      if (text.trim()) lastText = text;

      if (toolCalls.length === 0) {
        // Guard the small-Gemma "empty final answer after a tool round" quirk.
        if (text.trim() !== "") {
          emit({ type: "done", text });
          return;
        }
        messages.push({ role: "system", content: "State the final answer to the student in plain text now." });
        const retry = await runTurn(messages, emit);
        emit({ type: "done", text: retry.text.trim() || "(no answer produced)" });
        return;
      }

      messages.push({ role: "assistant", content: text, tool_calls: toolCalls });
      for (const call of toolCalls) {
        const name = call.function.name;
        emit({ type: "tool", name, phase: "call", detail: JSON.stringify(call.function.arguments) });
        const result = dispatchTool(name, call.function.arguments ?? {}, ctx);
        emit({ type: "tool", name, phase: "result", detail: result });
        messages.push({ role: "tool", tool_name: name, content: result });
      }
      // Emit any graphs this round produced.
      for (const spec of ctx.plots.splice(0)) emit({ type: "plot", spec });
    }
    // Hit the round cap — fall back to the best answer text we streamed, since
    // small Gemma often emits its final prose alongside one last tool call.
    emit({ type: "done", text: lastText.trim() || "Reached the tool-round limit without a final answer." });
  } catch (err) {
    emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

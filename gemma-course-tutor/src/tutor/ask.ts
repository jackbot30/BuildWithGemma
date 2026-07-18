/** RAG tutoring: retrieve course context → prompt Gemma → cited, LaTeX-preserving answer. */

import { chatStream, type ChatMessage } from "../ollama.ts";
import { retrieve, formatContext } from "../rag/retrieve.ts";
import type { Hit } from "../rag/store.ts";

const SYSTEM = [
  "You are a study tutor for a specific course. Answer ONLY using the provided course context.",
  "If the answer is not contained in the context, say you can't find it in the course material — do not guess.",
  "Preserve mathematical notation as LaTeX between $...$ (inline) or $$...$$ (display).",
  "Cite the sources you used by their bracket numbers, e.g. [1], [2].",
].join("\n");

function buildMessages(question: string, hits: Hit[]): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Course context:\n\n${formatContext(hits)}\n\n---\n\nQuestion: ${question}`,
    },
  ];
}

export type TutorEvent = { type: "context"; hits: Hit[] } | { type: "delta"; text: string };

/** Streamed tutoring — emits the retrieved context first, then answer deltas. */
export async function* askStream(question: string): AsyncGenerator<TutorEvent> {
  const hits = await retrieve(question);
  yield { type: "context", hits };
  for await (const delta of chatStream(buildMessages(question, hits), { temperature: 0.2 })) {
    yield { type: "delta", text: delta };
  }
}

export interface TutorResult {
  answer: string;
  hits: Hit[];
}

/** Buffered tutoring — full answer + the chunks it was grounded in. */
export async function ask(question: string): Promise<TutorResult> {
  let answer = "";
  let hits: Hit[] = [];
  for await (const ev of askStream(question)) {
    if (ev.type === "context") hits = ev.hits;
    else answer += ev.text;
  }
  return { answer, hits };
}

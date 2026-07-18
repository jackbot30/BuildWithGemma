/**
 * Local Ollama client — chat (streaming + buffered) and embeddings. Local only;
 * nothing here ever calls a remote host.
 */

import { loadConfig } from "./config.ts";

const cfg = loadConfig();

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatChunk {
  message?: { content?: string };
  done: boolean;
}

/** Stream a chat completion, yielding text deltas. */
export async function* chatStream(messages: ChatMessage[], opts: { temperature?: number } = {}): AsyncGenerator<string> {
  const res = await fetch(`${cfg.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.gemmaModel,
      messages,
      stream: true,
      keep_alive: "10m",
      options: { temperature: opts.temperature ?? 0.2 },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`Ollama chat ${res.status}: ${await res.text().catch(() => "")}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const chunk = JSON.parse(line) as ChatChunk;
      if (chunk.message?.content) yield chunk.message.content;
    }
  }
}

/** Buffered chat — collect the full response. */
export async function chat(messages: ChatMessage[], opts: { temperature?: number } = {}): Promise<string> {
  let out = "";
  for await (const delta of chatStream(messages, opts)) out += delta;
  return out;
}

/** Embed a single text via Ollama's embeddings endpoint. */
export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${cfg.ollamaUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Backstop against the embed model's context limit (a single huge input still throws 500).
    body: JSON.stringify({ model: cfg.embedModel, prompt: text.slice(0, 6000) }),
  });
  if (!res.ok) throw new Error(`Ollama embeddings ${res.status}: ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { embedding?: number[] };
  if (!data.embedding?.length) throw new Error("empty embedding from Ollama");
  return data.embedding;
}

/** Is Ollama reachable and is the given model present? */
export async function checkOllama(model: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(`${cfg.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, reason: `tags ${res.status}` };
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const names = (data.models ?? []).map((m) => m.name);
    // Ollama lists untagged models as "name:latest"; accept either spelling.
    const wanted = model.includes(":") ? model : `${model}:latest`;
    if (!names.includes(model) && !names.includes(wanted)) {
      return { ok: false, reason: `model "${model}" not pulled (have: ${names.join(", ")})` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

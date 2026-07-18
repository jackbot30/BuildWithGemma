/**
 * Native Ollama /api/chat client. We use the NATIVE endpoint (not the OpenAI-compat
 * /v1 route) because Gemma 4 streamed tool_calls aren't parsed correctly there.
 *
 * On the native endpoint: tool_call.function.arguments is already a parsed OBJECT
 * (not a JSON string), and there is no `id` field on tool calls.
 */

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
export const MODEL = process.env.MATH_SYNC_MODEL ?? "gemma4:e4b";

export interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

export interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

interface OllamaChunk {
  message?: OllamaMessage;
  done: boolean;
  done_reason?: string;
}

export interface ChatBody {
  model?: string;
  messages: OllamaMessage[];
  tools?: ToolSchema[];
  stream?: boolean;
  keep_alive?: string;
  options?: { temperature?: number; num_predict?: number };
}

/** Stream /api/chat as NDJSON, yielding each parsed chunk. */
export async function* streamChat(body: ChatBody): AsyncGenerator<OllamaChunk> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, keep_alive: "10m", ...body, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`Ollama ${res.status}: ${await res.text().catch(() => "")}`);

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
      if (line) yield JSON.parse(line) as OllamaChunk;
    }
  }
  if (buf.trim()) yield JSON.parse(buf.trim()) as OllamaChunk;
}

/** Fire-and-forget load so the model is resident before the first user turn. */
export async function prewarm(): Promise<void> {
  try {
    await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages: [], keep_alive: "30m" }),
    });
  } catch {
    // Ollama may be offline at boot — the first real turn will surface the error.
  }
}

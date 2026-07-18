/**
 * Native Ollama /api/chat client. We use the NATIVE endpoint (not the OpenAI-compat
 * /v1 route) because Gemma 4 streamed tool_calls aren't parsed correctly there.
 *
 * On the native endpoint: tool_call.function.arguments is already a parsed OBJECT
 * (not a JSON string), and there is no `id` field on tool calls.
 */

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
// Demo default: gemma4:e2b — matched e4b at 10/10 with tools on the eval set and is
// ~1.6–2.3x faster on CPU (see docs/decisions/hackathon-log.md, Jul 18).
export const MODEL = process.env.MATH_SYNC_MODEL ?? "gemma4:e2b";

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

export interface OllamaChunk {
  message?: OllamaMessage;
  done: boolean;
  done_reason?: string;
  /** Final chunk only: tokens generated + generation time in ns (feeds the trace's tok/s). */
  eval_count?: number;
  eval_duration?: number;
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
    body: JSON.stringify({ model: MODEL, keep_alive: "30m", ...body, stream: true }),
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

/**
 * Result of the boot-time reachability probe. Pure/structured so the caller (and
 * tests) decide what to do — no process.exit lives in here.
 *  - reachable:    Ollama answered /api/version within the timeout.
 *  - modelPresent: MODEL was found in /api/tags (best-effort; false if tags failed).
 *  - shouldExit:   true only when Ollama is unreachable (a missing model is a warning).
 *  - message:      an operator-actionable line to print.
 */
export interface OllamaReachability {
  reachable: boolean;
  modelPresent: boolean;
  shouldExit: boolean;
  message: string;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Probe Ollama at boot: short-timeout GET /api/version, then GET /api/tags to see
 * whether MODEL is pulled. Never throws — always resolves to an OllamaReachability.
 * `fetchFn` is injectable so this is unit-testable without a live Ollama.
 */
export async function assertOllamaReachable(
  fetchFn: FetchFn = globalThis.fetch,
  timeoutMs = 2500,
): Promise<OllamaReachability> {
  const pullHint = `Ollama not reachable at ${OLLAMA_URL} — run \`ollama serve\` and \`ollama pull ${MODEL}\``;

  let versionOk = false;
  try {
    const res = await fetchFn(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(timeoutMs) });
    versionOk = res.ok;
  } catch {
    versionOk = false;
  }

  if (!versionOk) {
    return { reachable: false, modelPresent: false, shouldExit: true, message: pullHint };
  }

  // Reachable — best-effort model check. A tags failure must NOT block boot.
  let modelPresent = false;
  try {
    const res = await fetchFn(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
      const tags = data.models ?? [];
      modelPresent = tags.some((m) => m.name === MODEL || m.model === MODEL);
    }
  } catch {
    modelPresent = false;
  }

  const message = modelPresent
    ? `Ollama reachable at ${OLLAMA_URL}; model ${MODEL} is available.`
    : `WARNING: Ollama is up at ${OLLAMA_URL} but model ${MODEL} is not pulled — run \`ollama pull ${MODEL}\` (the first turn will fail otherwise).`;

  return { reachable: true, modelPresent, shouldExit: false, message };
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

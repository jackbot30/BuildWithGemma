/**
 * Course Tutor server (Bun). No build step: serves public/ directly and streams
 * the on-device RAG tutor over SSE. With --open it launches Edge in --app mode
 * (a chromeless standalone window) so it feels like a desktop app.
 *
 *   bun run serve            # server + open the app window
 *   bun run src/server.ts    # server only
 */

import { resolve, extname } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.ts";
import { askStream } from "./tutor/ask.ts";

const PORT = 8720; // math-sync uses 8710 — offset to avoid clashing.
const HOST = "127.0.0.1";
const PUBLIC = resolve(import.meta.dir, "..", "public");
const IDLE_EXIT_MS = 30_000;
const NEVER_OPENED_EXIT_MS = 10 * 60_000;
const wantOpen = process.argv.includes("--open");
const cfg = loadConfig();

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function openAppWindow(url: string): void {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  const edge = candidates.find((p) => existsSync(p));
  if (!edge) {
    console.error(`Edge not found — open ${url} manually in any browser.`);
    return;
  }
  Bun.spawn([edge, `--app=${url}`], { stdout: "ignore", stderr: "ignore" });
}

// Reuse a running instance instead of starting a duplicate.
const existing = await fetch(`http://${HOST}:${PORT}/api/heartbeat`, {
  signal: AbortSignal.timeout(400),
}).catch(() => null);
if (existing?.status === 204) {
  if (wantOpen) openAppWindow(`http://localhost:${PORT}`);
  console.log(`Gemma Course Tutor already running on port ${PORT}.`);
  process.exit(0);
}

let lastPing = 0;
let hadClient = false;
const startedAt = Date.now();

const json = (data: unknown, status = 200): Response => Response.json(data, { status });

function sse(controller: ReadableStreamDefaultController<Uint8Array>, event: unknown): void {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
}

function isMissingIndex(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no index|index\.json|bun run index/i.test(msg);
}

async function handleTutor(req: Request): Promise<Response> {
  let body: { question?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return json({ error: "question is required" }, 400);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const ev of askStream(question)) {
          sse(controller, ev);
        }
        sse(controller, { type: "done" });
      } catch (err) {
        const message = isMissingIndex(err)
          ? "No course index found — run `bun run index` first, then try again."
          : err instanceof Error
            ? err.message
            : String(err);
        sse(controller, { type: "error", message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  // SSE tutoring turns can run minutes on CPU — don't let Bun kill the stream.
  // (255s is Bun's max; each streamed event resets the idle clock.)
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api/heartbeat") {
      lastPing = Date.now();
      hadClient = true;
      return new Response(null, { status: 204 });
    }
    if (path === "/api/tutor" && req.method === "POST") return handleTutor(req);

    // Static files, contained to public/.
    const filePath = resolve(PUBLIC, "." + (path === "/" ? "/index.html" : path));
    if (!filePath.startsWith(PUBLIC)) return new Response("forbidden", { status: 403 });
    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    const type = MIME[extname(filePath)];
    return new Response(file, type ? { headers: { "Content-Type": type } } : undefined);
  },
});

setInterval(() => {
  const idle = hadClient && Date.now() - lastPing > IDLE_EXIT_MS;
  const neverUsed = !hadClient && Date.now() - startedAt > NEVER_OPENED_EXIT_MS;
  if (idle || neverUsed) {
    console.log("No open app windows — shutting down.");
    process.exit(0);
  }
}, 5_000);

const url = `http://localhost:${server.port}`;
console.log(`Gemma Course Tutor serving at ${url} (model: ${cfg.gemmaModel})`);
if (wantOpen) openAppWindow(url);

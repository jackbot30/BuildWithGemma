/**
 * Math Sync server (Bun). No build step: serves public/ directly, proxies the
 * on-device Gemma tutor over SSE, and exposes course + eval APIs. With --open it
 * launches Edge in --app mode (a chromeless standalone window) so it feels like a
 * desktop app — no compile, no Defender ASR blocker.
 *
 *   bun run app      # server + open the app window
 *   bun run server   # server only
 */

import { resolve, extname } from "node:path";
import { existsSync } from "node:fs";
import { loadCourse } from "./src/course.ts";
import { buildOutline } from "./src/outline.ts"; // course-nav (feat/course-nav)
import { runAgent, type AgentEvent } from "./src/agent.ts";
import { prewarm, MODEL, type OllamaMessage } from "./src/ollama.ts";
import { checkAnswer, checkSet } from "./src/checker.ts";

// PORT env override so a second instance can run alongside a live demo (e.g. for
// testing). Defaults to 8710 — the port the app + shortcut expect.
const PORT = Number(process.env.PORT) || 8710;
const HOST = "127.0.0.1";
const PUBLIC = resolve(import.meta.dir, "public");
const IDLE_EXIT_MS = 30_000;
const NEVER_OPENED_EXIT_MS = 10 * 60_000;
const wantOpen = process.argv.includes("--open");

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
  console.log(`Math Sync already running on port ${PORT}.`);
  process.exit(0);
}

// Load the course pack once at boot (COURSE_DIR overrides; defaults to sample-course).
const course = await loadCourse();
console.log(`Loaded course "${course.dir}" — ${course.lessons.length} lesson(s).`);
void prewarm(); // warm the model so the first turn isn't a cold start

let lastPing = 0;
let hadClient = false;
const startedAt = Date.now();

const json = (data: unknown, status = 200) => Response.json(data, { status });

function sse(controller: ReadableStreamDefaultController<Uint8Array>, event: AgentEvent): void {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
}

async function handleChat(req: Request): Promise<Response> {
  let body: { message?: unknown; history?: unknown; lessonId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const message = typeof body.message === "string" ? body.message : "";
  if (!message.trim()) return json({ error: "message is required" }, 400);
  const history = Array.isArray(body.history) ? (body.history as OllamaMessage[]) : [];

  // --- course-nav (feat/course-nav): "Ask about this lesson" ---------------
  // If the client sent a lessonId, prepend that lesson's content to this turn
  // so the model answers in the context of the open lesson.
  const lessonId = typeof body.lessonId === "string" ? body.lessonId : "";
  const openLesson = lessonId ? course.lessons.find((l) => l.id === lessonId) : undefined;
  const turn = openLesson
    ? `The student has this lesson open:\n\n${openLesson.content}\n\n---\n\nStudent question: ${message}`
    : message;
  // --- end course-nav -------------------------------------------------------

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await runAgent(history, turn, course, (e) => sse(controller, e));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

async function handleEval(): Promise<Response> {
  // Deterministic self-check demo: verify each answer key against itself (sanity)
  // and expose the problem set. Full with-tools-vs-raw run is eval/run.ts (CLI).
  // TODO(sat): wire this endpoint to run the model live and return the pass table.
  const file = Bun.file(resolve(import.meta.dir, "eval/problems.json"));
  const data = (await file.json()) as { problems: Array<{ id: string; type: string; answer: unknown }> };
  const selfCheck = data.problems.map((p) => {
    let ok = false;
    if (p.type === "numeric" && typeof p.answer === "string") ok = checkAnswer(p.answer, p.answer).equal;
    else if (Array.isArray(p.answer)) ok = checkSet(p.answer as string[], p.answer as string[]);
    return { id: p.id, checkerSelfConsistent: ok };
  });
  return json({ model: MODEL, problems: data.problems.length, selfCheck });
}

async function handleEvalResults(): Promise<Response> {
  // Serve the persisted eval runs for the Evidence tab. Written by `bun run eval`;
  // if it was never run, hand back an empty set rather than 404 (the tab renders
  // "no runs yet"). No run-from-the-UI here on purpose — see docs/decisions.
  const file = Bun.file(resolve(import.meta.dir, "eval/results.json"));
  if (!(await file.exists())) return json({ runs: [] });
  return json((await file.json()) as unknown);
}

// ── feat/trace BEGIN (whole feature lives in src/trace.ts; delete this block +
// the single "/api/traces" route line below to remove it) ──────────────────
import { getRecentTraces } from "./src/trace.ts";
function handleTraces(): Response {
  return json({ traces: getRecentTraces() });
}
// ── feat/trace END ──────────────────────────────────────────────────────────

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
    if (path === "/api/course") {
      return json({
        dir: course.dir,
        model: MODEL,
        lessons: course.lessons.map((l) => ({ id: l.id, title: l.title })),
      });
    }
    // --- course-nav (feat/course-nav): outline + lesson content ------------
    if (path === "/api/course/outline") {
      return json({ units: buildOutline(course.syllabus, course.lessons) });
    }
    if (path === "/api/course/lesson") {
      const id = url.searchParams.get("id") ?? "";
      const lesson = course.lessons.find((l) => l.id === id);
      if (!lesson) return json({ error: `lesson "${id}" not found` }, 404);
      return json({ id: lesson.id, title: lesson.title, content: lesson.content });
    }
    // --- end course-nav ------------------------------------------------------
    // --- BEGIN calculator feature (feat/calculator) — keep this block self-contained ---
    if (path === "/api/calculate" && req.method === "POST") {
      const { calculateExpression } = await import("./src/calc.ts"); // lazy: keeps this feature in one block
      let body: { expression?: unknown };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return json({ error: "invalid JSON" }, 400);
      }
      const expression = typeof body.expression === "string" ? body.expression : "";
      if (!expression.trim()) return json({ error: "expression is required" }, 400);
      return json({ result: calculateExpression(expression) });
    }
    // --- END calculator feature ---
    if (path === "/api/chat" && req.method === "POST") return handleChat(req);
    if (path === "/api/traces") return handleTraces(); // feat/trace
    if (path === "/api/eval/results") return handleEvalResults();
    if (path === "/api/eval") return handleEval();

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
console.log(`Math Sync serving at ${url} (model: ${MODEL})`);
if (wantOpen) openAppWindow(url);

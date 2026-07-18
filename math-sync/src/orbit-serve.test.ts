// orbit-integration-B: the one-process claim, tested end-to-end. Boots the real
// server on an ephemeral port and asserts BOTH UIs serve from it, Orbit's static
// assets resolve under /orbit/, the shared /srs.js scheduler is reachable (so
// flashcards.js's import works), and path traversal out of ../UI is refused.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

let proc: ReturnType<typeof Bun.spawn> | null = null;
let base = "";

async function waitForServer(url: string, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const ok = await fetch(url).then((r) => r.ok).catch(() => false);
    if (ok) return;
    await Bun.sleep(250);
  }
  throw new Error(`server never came up at ${url}`);
}

// 30s hook timeout: booting a fresh `bun run server.ts` can be slow under the
// CPU contention of the full test suite (default hook timeout is 5s).
beforeAll(async () => {
  const port = 3000 + Math.floor(Math.random() * 20000);
  base = `http://127.0.0.1:${port}`;
  const serverPath = resolve(import.meta.dir, "..", "server.ts");
  proc = Bun.spawn(["bun", "run", serverPath], {
    env: { ...process.env, PORT: String(port), MATH_SYNC_STAY_ALIVE: "1" },
    stdout: "ignore",
    stderr: "ignore",
  });
  await waitForServer(`${base}/api/course`);
}, 30_000);

afterAll(() => {
  proc?.kill();
});

describe("one-process serving", () => {
  test("math-sync UI still served at /", async () => {
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
  });

  test("Orbit served at /orbit/ with its <base> tag", async () => {
    const r = await fetch(`${base}/orbit/`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('<base href="/orbit/">');
  });

  test("Orbit static assets resolve under /orbit/", async () => {
    for (const [path, type] of [
      ["/orbit/style.css", "text/css"],
      ["/orbit/app.js", "text/javascript"],
      ["/orbit/flashcards.js", "text/javascript"],
    ] as const) {
      const r = await fetch(`${base}${path}`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain(type);
    }
  });

  test("shared SRS scheduler is reachable at /srs.js (flashcards.js import target)", async () => {
    const r = await fetch(`${base}/srs.js`);
    expect(r.status).toBe(200);
    const body = await r.text();
    // Single source of scheduling — the module Orbit and math-sync both import.
    expect(body).toContain("export function grade");
    expect(body).toContain("export function buildQueue");
  });

  test("API + vendor routes are same-origin for Orbit (no proxy)", async () => {
    expect((await fetch(`${base}/api/course`)).status).toBe(200);
    expect((await fetch(`${base}/api/course/outline`)).status).toBe(200);
    expect((await fetch(`${base}/vendor/katex/katex.min.js`)).status).toBe(200);
  });

  test("path traversal out of ../UI is refused", async () => {
    const r = await fetch(`${base}/orbit/../server.ts`);
    // resolve() normalizes the path back inside math-sync/public, where server.ts
    // doesn't exist -> 404 (never 200 leaking source).
    expect(r.status).not.toBe(200);
  });
});

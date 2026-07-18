/**
 * Unit tests for the Evidence results store (no model needed). Covers the append /
 * update-in-place / never-clobber contract and the summary math.
 */

import { test, expect, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { readResults, upsertRun, summarize, type Run } from "./results.ts";

// Each test gets its own temp file so runs don't interfere.
const files: string[] = [];
function tmpFile(): string {
  const p = join(tmpdir(), `math-sync-results-${crypto.randomUUID()}.json`);
  files.push(p);
  return p;
}
afterEach(() => {
  for (const f of files.splice(0)) if (existsSync(f)) rmSync(f);
});

function run(startedAt: string, overrides: Partial<Run> = {}): Run {
  return {
    name: "test run",
    model: "gemma4:e4b",
    mode: "raw",
    startedAt,
    done: false,
    problems: [],
    passRate: "0/0",
    avgSeconds: null,
    ...overrides,
  };
}

test("readResults returns empty set when the file is missing", async () => {
  const path = tmpFile();
  expect(await readResults(path)).toEqual({ runs: [] });
});

test("summarize counts passes and averages seconds; null avg for no problems", () => {
  expect(summarize([])).toEqual({ passRate: "0/0", avgSeconds: null });
  const s = summarize([
    { id: "a", question: "q", expected: "1", got: "1", pass: true, seconds: 2 },
    { id: "b", question: "q", expected: "2", got: "3", pass: false, seconds: 4 },
  ]);
  expect(s).toEqual({ passRate: "1/2", avgSeconds: 3 });
});

test("upsertRun appends a new run and fills passRate/avgSeconds from problems", async () => {
  const path = tmpFile();
  await upsertRun(path, run("2026-07-18T10:00:00.000Z", {
    problems: [{ id: "a", question: "q", expected: "1", got: "1", pass: true, seconds: 5 }],
  }));
  const data = await readResults(path);
  expect(data.runs.length).toBe(1);
  expect(data.runs[0]?.passRate).toBe("1/1");
  expect(data.runs[0]?.avgSeconds).toBe(5);
});

test("upsertRun updates the run with the same startedAt in place (no duplicate)", async () => {
  const path = tmpFile();
  const started = "2026-07-18T10:00:00.000Z";
  await upsertRun(path, run(started, { problems: [] }));
  await upsertRun(path, run(started, {
    done: true,
    problems: [{ id: "a", question: "q", expected: "1", got: "1", pass: true, seconds: 3 }],
  }));
  const data = await readResults(path);
  expect(data.runs.length).toBe(1); // updated in place, not appended twice
  expect(data.runs[0]?.done).toBe(true);
  expect(data.runs[0]?.passRate).toBe("1/1");
});

test("upsertRun never clobbers an existing (differently-dated) run", async () => {
  const path = tmpFile();
  await upsertRun(path, run("2026-07-17T00:00:00.000Z", { name: "baseline" }));
  await upsertRun(path, run("2026-07-18T10:00:00.000Z", { name: "fresh" }));
  const data = await readResults(path);
  expect(data.runs.length).toBe(2);
  expect(data.runs.map((r) => r.name)).toEqual(["baseline", "fresh"]);
});

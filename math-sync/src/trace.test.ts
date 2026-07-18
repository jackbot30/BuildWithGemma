/**
 * Red/green TDD for the trace-assembly module. All pure logic — no Ollama, no
 * server. Timing is driven by an injected fake clock; the JSONL sink writes to
 * a scratch file.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { unlinkSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  TraceBuilder,
  recordTrace,
  getRecentTraces,
  clearTraces,
  MAX_TRACES,
  type TurnTrace,
} from "./trace.ts";

/** Fake monotonic clock: each call to tick(n) advances by n ms. */
function fakeClock(start = 1000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

function makeBuilder(clock: { now: () => number }) {
  return new TraceBuilder({
    model: "gemma4:e4b",
    systemPromptChars: 421,
    userInput: "Solve x^2 - 5x + 6 = 0",
    now: clock.now,
  });
}

describe("TraceBuilder", () => {
  test("assembles rounds with tool calls, args, result summaries, durations", () => {
    const clock = fakeClock();
    const b = makeBuilder(clock);

    b.startRound();
    clock.tick(500); // model streamed for 500ms
    b.endRound();
    b.addToolCall("lookup_course", { query: "quadratics" }, "Lesson 2: Factoring...", 12);
    b.addToolCall("plot", { fn: "x^2-5x+6" }, "Graphed x^2-5x+6 on [-10, 10]", 3);

    b.startRound();
    clock.tick(700);
    b.endRound();

    clock.tick(100);
    const t = b.finish("answered");

    expect(t.model).toBe("gemma4:e4b");
    expect(t.systemPromptChars).toBe(421);
    expect(t.userInput).toBe("Solve x^2 - 5x + 6 = 0");
    expect(t.rounds).toHaveLength(2);
    expect(t.rounds[0]?.round).toBe(1);
    expect(t.rounds[0]?.modelMs).toBe(500);
    expect(t.rounds[0]?.toolCalls).toEqual([
      { name: "lookup_course", args: '{"query":"quadratics"}', result: "Lesson 2: Factoring...", durationMs: 12 },
      { name: "plot", args: '{"fn":"x^2-5x+6"}', result: "Graphed x^2-5x+6 on [-10, 10]", durationMs: 3 },
    ]);
    expect(t.rounds[1]?.modelMs).toBe(700);
    expect(t.totalMs).toBe(1300);
    expect(t.outcome).toBe("answered");
  });

  test("derives tokens/sec per round and aggregate from Ollama eval metadata", () => {
    const clock = fakeClock();
    const b = makeBuilder(clock);

    b.startRound();
    clock.tick(2000);
    b.endRound({ evalCount: 100, evalDurationNs: 2_000_000_000 }); // 50 tok/s

    b.startRound();
    clock.tick(4000);
    b.endRound({ evalCount: 100, evalDurationNs: 4_000_000_000 }); // 25 tok/s

    const t = b.finish("answered");
    expect(t.rounds[0]?.evalCount).toBe(100);
    expect(t.rounds[0]?.tokensPerSec).toBeCloseTo(50, 5);
    expect(t.rounds[1]?.tokensPerSec).toBeCloseTo(25, 5);
    expect(t.totalTokens).toBe(200);
    expect(t.tokensPerSec).toBeCloseTo(200 / 6, 5); // 200 tokens over 6s of eval time
  });

  test("omits token stats when Ollama metadata is absent", () => {
    const clock = fakeClock();
    const b = makeBuilder(clock);
    b.startRound();
    clock.tick(300);
    b.endRound(); // no metadata (e.g. connection dropped mid-stream)
    const t = b.finish("error", "boom");
    expect(t.rounds[0]?.evalCount).toBeUndefined();
    expect(t.rounds[0]?.tokensPerSec).toBeUndefined();
    expect(t.totalTokens).toBeUndefined();
    expect(t.tokensPerSec).toBeUndefined();
    expect(t.outcome).toBe("error");
    expect(t.error).toBe("boom");
  });

  test("records checker verdicts from check_answer results", () => {
    const clock = fakeClock();
    const b = makeBuilder(clock);
    b.startRound();
    b.endRound();
    b.addToolCall("check_answer", { answer: "2", expected: "2" }, "CORRECT — verified against the answer key.", 1);
    b.addToolCall("check_answer", { answer: "3", expected: "2" }, "INCORRECT — the proposed answer does not equal the expected answer.", 1);
    b.addToolCall("lookup_course", { query: "x" }, "not a verdict", 1);
    const t = b.finish("answered");
    expect(t.verdicts).toEqual(["correct", "incorrect"]);
  });

  test("truncates long tool results in the summary", () => {
    const clock = fakeClock();
    const b = makeBuilder(clock);
    b.startRound();
    b.endRound();
    b.addToolCall("lookup_course", { query: "x" }, "z".repeat(500), 1);
    const t = b.finish("answered");
    const summary = t.rounds[0]?.toolCalls[0]?.result ?? "";
    expect(summary.length).toBeLessThanOrEqual(201); // 200 chars + ellipsis
    expect(summary.endsWith("…")).toBe(true);
  });
});

describe("trace store", () => {
  const SCRATCH_LOG = resolve(import.meta.dir, "trace.test-scratch.log");

  beforeEach(() => {
    clearTraces();
    if (existsSync(SCRATCH_LOG)) unlinkSync(SCRATCH_LOG);
  });

  function stubTrace(id: string): TurnTrace {
    const clock = fakeClock();
    const b = new TraceBuilder({ model: "m", systemPromptChars: 1, userInput: id, now: clock.now });
    b.startRound();
    b.endRound();
    return b.finish("answered");
  }

  test("keeps only the last MAX_TRACES in memory, newest first", () => {
    for (let i = 0; i < MAX_TRACES + 5; i++) recordTrace(stubTrace(`q${i}`), null);
    const traces = getRecentTraces();
    expect(traces).toHaveLength(MAX_TRACES);
    expect(traces[0]?.userInput).toBe(`q${MAX_TRACES + 4}`); // newest first
    expect(traces.at(-1)?.userInput).toBe("q5"); // oldest kept
  });

  test("appends one JSON line per trace to the log file", () => {
    recordTrace(stubTrace("first"), SCRATCH_LOG);
    recordTrace(stubTrace("second"), SCRATCH_LOG);
    const lines = readFileSync(SCRATCH_LOG, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const parsed = lines.map((l) => JSON.parse(l) as TurnTrace);
    expect(parsed[0]?.userInput).toBe("first");
    expect(parsed[1]?.userInput).toBe("second");
  });

  test("a failing log write does not lose the in-memory trace", () => {
    recordTrace(stubTrace("kept"), "Z:\\no\\such\\dir\\traces.log");
    expect(getRecentTraces()[0]?.userInput).toBe("kept");
  });
});

/**
 * Tests for assertOllamaReachable() — the loud boot check.
 * Written RED-first: assertOllamaReachable does not yet exist in ollama.ts.
 *
 * The helper must be PURE and MOCKABLE: it takes an injectable fetch (so we don't
 * touch a real Ollama here) and returns a structured result. No process.exit inside.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { assertOllamaReachable, MODEL, type OllamaReachability } from "./ollama.ts";

// A tiny typed fetch stub so we never cast to any and never hit the network.
type FetchLike = (input: string) => Promise<Response>;

function versionResponse(): Response {
  return new Response(JSON.stringify({ version: "9.9.9" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function tagsResponse(names: string[]): Response {
  return new Response(JSON.stringify({ models: names.map((n) => ({ name: n, model: n })) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  // No global fetch mutation to undo — we inject fetch — but keep the hook so a
  // future refactor to spyOn(globalThis, "fetch") has a restore point.
});

describe("assertOllamaReachable — Ollama down", () => {
  test("connection refused → reachable:false, actionable message, exit-worthy", async () => {
    const fetchStub: FetchLike = () => Promise.reject(new Error("ECONNREFUSED"));
    const r: OllamaReachability = await assertOllamaReachable(fetchStub);
    expect(r.reachable).toBe(false);
    expect(r.shouldExit).toBe(true);
    // message must name the URL and the two fix commands so the operator can act
    expect(r.message).toContain("11434");
    expect(r.message.toLowerCase()).toContain("ollama serve");
    expect(r.message).toContain(MODEL);
  });

  test("times out → reachable:false, shouldExit:true (never throws)", async () => {
    const fetchStub: FetchLike = () => Promise.reject(new Error("The operation timed out"));
    let r: OllamaReachability | undefined;
    await expect(
      (async () => {
        r = await assertOllamaReachable(fetchStub);
      })(),
    ).resolves.toBeUndefined();
    expect(r?.reachable).toBe(false);
    expect(r?.shouldExit).toBe(true);
  });
});

describe("assertOllamaReachable — reachable, model present", () => {
  test("version 200 + tags contains MODEL → reachable + modelPresent, no exit", async () => {
    const fetchStub: FetchLike = (input) =>
      Promise.resolve(input.includes("/api/tags") ? tagsResponse([MODEL, "other:latest"]) : versionResponse());
    const r = await assertOllamaReachable(fetchStub);
    expect(r.reachable).toBe(true);
    expect(r.modelPresent).toBe(true);
    expect(r.shouldExit).toBe(false);
  });
});

describe("assertOllamaReachable — reachable, model MISSING", () => {
  test("version 200 but MODEL absent from tags → reachable, modelPresent:false, WARN not exit", async () => {
    const fetchStub: FetchLike = (input) =>
      Promise.resolve(input.includes("/api/tags") ? tagsResponse(["something-else:latest"]) : versionResponse());
    const r = await assertOllamaReachable(fetchStub);
    expect(r.reachable).toBe(true);
    expect(r.modelPresent).toBe(false);
    expect(r.shouldExit).toBe(false); // missing model is a warning, not fatal
    expect(r.message).toContain(MODEL); // message tells operator to pull it
  });

  test("matches the model by base name even if tag lists it with a suffix variant", async () => {
    // Ollama sometimes reports the same model under an exact tag; make sure an
    // exact-name match is what we require (no accidental substring false-positive).
    const fetchStub: FetchLike = (input) =>
      Promise.resolve(input.includes("/api/tags") ? tagsResponse([`${MODEL}`]) : versionResponse());
    const r = await assertOllamaReachable(fetchStub);
    expect(r.modelPresent).toBe(true);
  });
});

describe("assertOllamaReachable — version reachable but /api/tags fails", () => {
  test("tags fetch errors → still reachable (don't block boot), modelPresent:false", async () => {
    const fetchStub: FetchLike = (input) => {
      if (input.includes("/api/tags")) return Promise.reject(new Error("boom"));
      return Promise.resolve(versionResponse());
    };
    const r = await assertOllamaReachable(fetchStub);
    expect(r.reachable).toBe(true);
    expect(r.shouldExit).toBe(false);
    expect(r.modelPresent).toBe(false);
  });
});

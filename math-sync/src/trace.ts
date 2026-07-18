/**
 * Gemma trace system — structured "what the model actually did" evidence.
 *
 * Isolated on purpose: the agent loop *feeds* a TraceBuilder and the server
 * reads the store; nothing here imports agent/server code, so deleting this
 * feature is: remove this file + the few marked call sites.
 *
 * Storage: last MAX_TRACES turns in memory (for GET /api/traces + the UI
 * drawer) and an append-only JSONL traces.log next to the app (gitignored).
 */

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";

export interface TraceToolCall {
  name: string;
  /** JSON-encoded arguments the model sent. */
  args: string;
  /** Tool result, truncated to RESULT_SUMMARY_CHARS. */
  result: string;
  durationMs: number;
}

export interface TraceRound {
  /** 1-based round number within the turn. */
  round: number;
  /** Wall time of the streamed model call for this round. */
  modelMs: number;
  /** Tokens generated this round (Ollama final-chunk eval_count). */
  evalCount?: number;
  /** evalCount / eval_duration — the honest CPU tok/s number. */
  tokensPerSec?: number;
  toolCalls: TraceToolCall[];
}

export type TraceOutcome = "answered" | "retry-answered" | "round-cap" | "error";
export type Verdict = "correct" | "incorrect";

export interface TurnTrace {
  id: string;
  startedAt: string; // ISO timestamp
  model: string;
  systemPromptChars: number;
  userInput: string;
  rounds: TraceRound[];
  /** Every check_answer verdict seen this turn, in order. */
  verdicts: Verdict[];
  totalMs: number;
  totalTokens?: number;
  /** Aggregate generation speed across all rounds (eval time only). */
  tokensPerSec?: number;
  outcome: TraceOutcome;
  error?: string;
}

const RESULT_SUMMARY_CHARS = 200;
export const MAX_TRACES = 20;
const TRACES_LOG = resolve(import.meta.dir, "..", "traces.log");

function summarize(result: string): string {
  return result.length > RESULT_SUMMARY_CHARS ? `${result.slice(0, RESULT_SUMMARY_CHARS)}…` : result;
}

interface BuilderOptions {
  model: string;
  systemPromptChars: number;
  userInput: string;
  /** Injectable clock (ms) for tests; defaults to Date.now. */
  now?: () => number;
}

export interface RoundMeta {
  evalCount?: number;
  evalDurationNs?: number;
}

/** Accumulates one user turn's trace as the agent loop runs. */
export class TraceBuilder {
  private readonly now: () => number;
  private readonly t0: number;
  private readonly trace: TurnTrace;
  private roundStart: number | null = null;
  private evalDurationNsTotal = 0;

  constructor(opts: BuilderOptions) {
    this.now = opts.now ?? Date.now;
    this.t0 = this.now();
    this.trace = {
      id: `t${this.t0.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt: new Date().toISOString(),
      model: opts.model,
      systemPromptChars: opts.systemPromptChars,
      userInput: opts.userInput,
      rounds: [],
      verdicts: [],
      totalMs: 0,
      outcome: "error",
    };
  }

  /** Mark the start of a streamed model call. */
  startRound(): void {
    this.roundStart = this.now();
  }

  /** Close the current model call, with the final Ollama chunk's eval metadata if present. */
  endRound(meta?: RoundMeta): void {
    const start = this.roundStart ?? this.now();
    this.roundStart = null;
    const round: TraceRound = {
      round: this.trace.rounds.length + 1,
      modelMs: this.now() - start,
      toolCalls: [],
    };
    if (meta?.evalCount !== undefined) {
      round.evalCount = meta.evalCount;
      this.trace.totalTokens = (this.trace.totalTokens ?? 0) + meta.evalCount;
      if (meta.evalDurationNs && meta.evalDurationNs > 0) {
        round.tokensPerSec = meta.evalCount / (meta.evalDurationNs / 1e9);
        this.evalDurationNsTotal += meta.evalDurationNs;
      }
    }
    this.trace.rounds.push(round);
  }

  /** Record one dispatched tool call (attached to the most recent round). */
  addToolCall(name: string, args: Record<string, unknown>, result: string, durationMs: number): void {
    const round = this.trace.rounds.at(-1);
    if (!round) return; // tool calls only ever follow a model round
    round.toolCalls.push({ name, args: JSON.stringify(args), result: summarize(result), durationMs });
    if (name === "check_answer") {
      this.trace.verdicts.push(result.startsWith("CORRECT") ? "correct" : "incorrect");
    }
  }

  /** Finalize and return the immutable turn trace. */
  finish(outcome: TraceOutcome, error?: string): TurnTrace {
    this.trace.totalMs = this.now() - this.t0;
    this.trace.outcome = outcome;
    if (error !== undefined) this.trace.error = error;
    if (this.trace.totalTokens !== undefined && this.evalDurationNsTotal > 0) {
      this.trace.tokensPerSec = this.trace.totalTokens / (this.evalDurationNsTotal / 1e9);
    }
    return this.trace;
  }
}

// ── In-memory ring + JSONL sink ────────────────────────────────────────────

const recent: TurnTrace[] = [];

/**
 * Store a finished trace. `logPath` overrides the JSONL file (tests);
 * pass `null` to skip file logging entirely.
 */
export function recordTrace(trace: TurnTrace, logPath: string | null = TRACES_LOG): void {
  recent.push(trace);
  if (recent.length > MAX_TRACES) recent.splice(0, recent.length - MAX_TRACES);
  if (logPath !== null) {
    try {
      appendFileSync(logPath, `${JSON.stringify(trace)}\n`, "utf8");
    } catch (err) {
      // Never let evidence logging break the tutor.
      console.error(`trace: could not append to ${logPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Recent traces, newest first (for GET /api/traces and the Trace tab). */
export function getRecentTraces(): TurnTrace[] {
  return [...recent].reverse();
}

/** Test helper. */
export function clearTraces(): void {
  recent.length = 0;
}

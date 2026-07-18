/**
 * Evidence results store — read / append / update eval runs on disk.
 *
 * Split out from run.ts so it can be unit-tested WITHOUT a model: run.ts drives
 * Gemma; this file is pure file I/O over a plain JSON document. A long eval run
 * writes here after every problem so the file is monitorable mid-flight and
 * survives an interruption (a partial run is left with done:false).
 */

import { resolve, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

export interface ProblemResult {
  id: string;
  question: string;
  expected: string | string[];
  got: string;
  pass: boolean;
  seconds: number;
}

export interface Run {
  name: string;
  model: string;
  mode: "raw" | "tools";
  startedAt: string; // ISO
  done: boolean;
  problems: ProblemResult[];
  passRate: string; // "n/N"
  avgSeconds: number | null;
  note?: string;
}

export interface ResultsFile {
  runs: Run[];
}

/** Default location of the committed results file (eval/results.json). */
export function defaultResultsPath(): string {
  return resolve(import.meta.dir, "results.json");
}

/** Read the results file, or an empty { runs: [] } if it doesn't exist yet. */
export async function readResults(path: string): Promise<ResultsFile> {
  if (!existsSync(path)) return { runs: [] };
  const parsed = (await Bun.file(path).json()) as unknown;
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { runs?: unknown }).runs)
  ) {
    return parsed as ResultsFile;
  }
  // Corrupt / unexpected shape — don't throw away nothing, start fresh.
  return { runs: [] };
}

/** Write the whole document back to disk (pretty-printed, trailing newline). */
export async function writeResults(path: string, data: ResultsFile): Promise<void> {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
}

/**
 * Compute passRate ("n/N") and avgSeconds from a run's problems. avgSeconds is
 * null when there are no problems yet (e.g. a quoted baseline or a just-started run).
 */
export function summarize(problems: ProblemResult[]): { passRate: string; avgSeconds: number | null } {
  const n = problems.length;
  const passed = problems.filter((p) => p.pass).length;
  const avgSeconds =
    n === 0 ? null : Math.round((problems.reduce((s, p) => s + p.seconds, 0) / n) * 100) / 100;
  return { passRate: `${passed}/${n}`, avgSeconds };
}

/**
 * Append `run` to the file at `path`, or, if a run with the same startedAt already
 * exists, replace it in place (so incremental writes update the same run rather than
 * piling up duplicates). Recomputes passRate/avgSeconds from the run's problems.
 * Existing runs are never clobbered. Returns the run after summary fields are filled.
 */
export async function upsertRun(path: string, run: Run): Promise<Run> {
  const { passRate, avgSeconds } = summarize(run.problems);
  const filled: Run = { ...run, passRate, avgSeconds };
  const data = await readResults(path);
  const idx = data.runs.findIndex((r) => r.startedAt === filled.startedAt);
  if (idx === -1) data.runs.push(filled);
  else data.runs[idx] = filled;
  await writeResults(path, data);
  return filled;
}

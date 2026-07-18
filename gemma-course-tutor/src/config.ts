/** All model + endpoint config in one place, read from the environment (.env). */

import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface Config {
  ollamaUrl: string;
  gemmaModel: string;
  embedModel: string;
  topK: number;
  coursePackDir: string;
  storeDir: string;
}

export interface CoursePackResolution {
  /** Explicit override (e.g. COURSE_PACK_DIR); wins if set, even if it doesn't exist yet. */
  explicit?: string;
  /** The private/local course pack — preferred when it actually has lessons. */
  primaryDir: string;
  /** The sample course bundled in the repo — the fresh-clone fallback. */
  fallbackDir: string;
}

/** True when `<dir>/lessons` exists and holds at least one .md file. */
function hasLessons(dir: string): boolean {
  try {
    return readdirSync(join(dir, "lessons")).some((f) => f.endsWith(".md"));
  } catch {
    return false; // dir or lessons/ missing → treat as "no course here"
  }
}

/**
 * Decide which course pack to use. An explicit override wins; otherwise prefer the
 * private primary pack when it has lessons, and fall back to the bundled sample course
 * so a fresh clone runs out of the box. Pure (no env / no Ollama) so it's unit-testable.
 */
export function resolveCoursePackDir({
  explicit,
  primaryDir,
  fallbackDir,
}: CoursePackResolution): string {
  const explicitDir = explicit?.trim();
  if (explicitDir) return resolve(explicitDir);
  if (hasLessons(primaryDir)) return resolve(primaryDir);
  return resolve(fallbackDir);
}

export function loadConfig(): Config {
  const env = process.env;
  return {
    ollamaUrl: env.OLLAMA_URL ?? "http://localhost:11434",
    // No public "gemma4" tag exists off this machine; default to what's pulled here.
    gemmaModel: env.GEMMA_MODEL ?? "gemma4:e4b",
    embedModel: env.EMBED_MODEL ?? "nomic-embed-text",
    topK: Number(env.TOP_K ?? "5"),
    // Prefer the private pack when present; otherwise use the bundled sample course so a
    // fresh clone works out of the box. COURSE_PACK_DIR still overrides everything.
    coursePackDir: resolveCoursePackDir({
      explicit: env.COURSE_PACK_DIR,
      primaryDir: "./course-pack",
      fallbackDir: "./sample-course",
    }),
    storeDir: resolve(env.STORE_DIR ?? "./store"),
  };
}

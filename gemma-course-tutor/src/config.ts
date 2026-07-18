/** All model + endpoint config in one place, read from the environment (.env). */

import { resolve } from "node:path";

export interface Config {
  ollamaUrl: string;
  gemmaModel: string;
  embedModel: string;
  topK: number;
  coursePackDir: string;
  storeDir: string;
}

export function loadConfig(): Config {
  const env = process.env;
  return {
    ollamaUrl: env.OLLAMA_URL ?? "http://localhost:11434",
    // No public "gemma4" tag exists off this machine; default to what's pulled here.
    gemmaModel: env.GEMMA_MODEL ?? "gemma4:e4b",
    embedModel: env.EMBED_MODEL ?? "nomic-embed-text",
    topK: Number(env.TOP_K ?? "5"),
    coursePackDir: resolve(env.COURSE_PACK_DIR ?? "./course-pack"),
    storeDir: resolve(env.STORE_DIR ?? "./store"),
  };
}

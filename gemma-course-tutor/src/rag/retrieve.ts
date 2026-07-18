/** Retrieve top-k course chunks for a query. Loads the store once per process. */

import { loadConfig } from "../config.ts";
import { embed } from "../ollama.ts";
import { loadStore, topK, type VectorStore, type Hit } from "./store.ts";

const cfg = loadConfig();
let cached: VectorStore | null = null;

async function store(): Promise<VectorStore> {
  if (!cached) cached = await loadStore(cfg.storeDir);
  return cached;
}

export async function retrieve(query: string, k = cfg.topK): Promise<Hit[]> {
  const s = await store();
  const q = await embed(query);
  return topK(s, q, k);
}

/** Format retrieved chunks as a context block with citation tags. */
export function formatContext(hits: Hit[]): string {
  return hits
    .map((h, i) => `[${i + 1}] (${h.chunk.file} › ${h.chunk.heading || h.chunk.lessonTitle})\n${h.chunk.text}`)
    .join("\n\n---\n\n");
}

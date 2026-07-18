/**
 * Flat JSON vector store — the corpus is ~740 KB, so simplicity beats a DB.
 * Stores each chunk + its embedding; retrieval is cosine similarity in-process.
 */

import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { Chunk } from "./chunk.ts";

export interface StoredChunk extends Chunk {
  embedding: number[];
}

export interface VectorStore {
  model: string; // embedding model used (so we can warn on mismatch)
  chunks: StoredChunk[];
}

const STORE_FILE = "index.json";

export async function saveStore(storeDir: string, store: VectorStore): Promise<string> {
  await mkdir(storeDir, { recursive: true });
  const path = join(storeDir, STORE_FILE);
  await Bun.write(path, JSON.stringify(store));
  return path;
}

export async function loadStore(storeDir: string): Promise<VectorStore> {
  const path = resolve(storeDir, STORE_FILE);
  if (!existsSync(path)) {
    throw new Error(`No index at ${path} — run \`bun run index\` first.`);
  }
  return (await Bun.file(path).json()) as VectorStore;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export interface Hit {
  chunk: StoredChunk;
  score: number;
}

export function topK(store: VectorStore, queryEmbedding: number[], k: number): Hit[] {
  return store.chunks
    .map((chunk) => ({ chunk, score: cosine(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

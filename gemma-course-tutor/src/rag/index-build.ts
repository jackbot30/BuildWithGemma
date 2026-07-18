/** `bun run index` — chunk lessons, embed each chunk, write the local vector store. */

import { join } from "node:path";
import { loadConfig } from "../config.ts";
import { checkOllama, embed } from "../ollama.ts";
import { chunkAllLessons } from "./chunk.ts";
import { saveStore, type StoredChunk } from "./store.ts";

const cfg = loadConfig();

const check = await checkOllama(cfg.embedModel);
if (!check.ok) {
  console.error(`Cannot build index: ${check.reason}`);
  console.error(`Pull it with:  ollama pull ${cfg.embedModel}`);
  process.exit(1);
}

const lessonsDir = join(cfg.coursePackDir, "lessons");
console.log(`Chunking lessons in ${lessonsDir} ...`);
const chunks = await chunkAllLessons(lessonsDir);
console.log(`${chunks.length} chunks. Embedding with ${cfg.embedModel} (this runs locally) ...`);

const stored: StoredChunk[] = [];
let done = 0;
for (const chunk of chunks) {
  // Embed the heading + text so lesson/section context is in the vector.
  const embedding = await embed(`${chunk.lessonTitle} — ${chunk.heading}\n${chunk.text}`);
  stored.push({ ...chunk, embedding });
  done++;
  if (done % 25 === 0 || done === chunks.length) console.log(`  embedded ${done}/${chunks.length}`);
}

const path = await saveStore(cfg.storeDir, { model: cfg.embedModel, chunks: stored });
console.log(`Wrote ${stored.length} vectors → ${path}`);

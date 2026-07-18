/**
 * Course Tutor CLI (headless). Reads a question from argv, checks Ollama, then
 * streams a cited answer from the RAG core to stdout.
 *
 *   bun run tutor "What is a derivative?"
 */

import { loadConfig } from "../config.ts";
import { checkOllama } from "../ollama.ts";
import { askStream } from "./ask.ts";
import type { Hit } from "../rag/store.ts";

function usage(): void {
  console.log("Usage: bun run tutor <question>");
  console.log('Example: bun run tutor "What is a derivative?"');
}

/** file › heading (falls back to the lesson title when a chunk has no heading). */
function sourceLabel(hit: Hit): string {
  const { file, heading, lessonTitle } = hit.chunk;
  return `${file} › ${heading || lessonTitle}`;
}

function isMissingIndex(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no index|index\.json|bun run index/i.test(msg);
}

async function main(): Promise<number> {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    usage();
    return 1;
  }

  const cfg = loadConfig();
  const health = await checkOllama(cfg.gemmaModel);
  if (!health.ok) {
    console.error(`Ollama not ready: ${health.reason ?? "unknown error"}`);
    console.error(`Hint: start Ollama and run  ollama pull ${cfg.gemmaModel}`);
    return 1;
  }

  console.log("Searching course…\n");

  let hits: Hit[] = [];
  let wroteAnswerHeader = false;
  try {
    for await (const ev of askStream(question)) {
      if (ev.type === "context") {
        hits = ev.hits;
        if (hits.length === 0) {
          console.log("No matching course context found.\n");
        } else {
          console.log("Cited sources:");
          for (const [i, hit] of hits.entries()) {
            console.log(`  [${i + 1}] ${sourceLabel(hit)}  (score ${hit.score.toFixed(3)})`);
          }
          console.log("");
        }
      } else {
        if (!wroteAnswerHeader) {
          process.stdout.write("Answer:\n");
          wroteAnswerHeader = true;
        }
        process.stdout.write(ev.text);
      }
    }
  } catch (err) {
    if (isMissingIndex(err)) {
      console.error("\nNo course index found — run  bun run index  first, then try again.");
      return 1;
    }
    console.error(`\nTutor failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (hits.length > 0) {
    console.log("\n\nSources:");
    for (const [i, hit] of hits.entries()) {
      console.log(`  [${i + 1}] ${sourceLabel(hit)}`);
    }
  }
  console.log("");
  return 0;
}

process.exit(await main());

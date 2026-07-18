# gemma-course-tutor

A **local, on-device** study tool that answers questions from your own course material
using Gemma (via Ollama) with retrieval-augmented generation, and measures how much the
course context actually helps with a two-mode eval harness.

Everything runs locally. No course content is ever sent to a remote service.

## ⚠️ Course content is NOT in this repository

This app runs over a **course pack** — a syllabus, lesson markdown, and an eval set.
The pack used to develop it is **copyrighted personal study material** (BYU Independent
Study MATH 056) and is **deliberately excluded from git**. If you cloned this repo, the
`course-pack/` folder is empty except for an explanation. So the app ships a small,
self-written **`sample-course/`** (3 original lessons) and falls back to it automatically
when `course-pack/` has no lessons — a fresh clone runs out of the box.

- **Why it's excluded and what belongs there:** [`course-pack/README.md`](course-pack/README.md)
- **The `.gitignore` rule** keeps every file under `course-pack/` out of version control
  except that one explanation file.
- **Bring your own pack** in the documented shape and the app works unchanged.

This is intentional: the reason to run Gemma locally is precisely so private/copyrighted
study material never has to leave the device.

## Stack

bun + TypeScript, Biome for lint/format. Gemma served locally via **Ollama**
(`http://localhost:11434`). Config lives in `.env` (see `.env.example`).

## Quickstart

```bash
bun install
ollama pull nomic-embed-text          # embeddings for retrieval
ollama pull gemma4:e4b                 # or set GEMMA_MODEL to any local tag
# (optional) a pack in course-pack/ overrides the bundled sample-course/
bun run index                          # chunk + embed lessons → ./store/index.json
bun run tutor "how do I find the distance between two points?"   # CLI
bun run serve                          # web UI in an Edge --app window (port 8720)
bun run eval baseline                  # closed-book vs open-book accuracy report
```

## How it works

1. **Index** (`src/rag/`) — lessons are chunked by heading (oversized sections are
   sub-split to fit the embed model), embedded with `nomic-embed-text`, and stored as a
   flat JSON vector store (~1200 vectors; the corpus is small, so no DB).
2. **Tutor** (`src/tutor/`) — a question retrieves the top-k chunks; Gemma answers
   **only** from that context, preserves `$...$` LaTeX, and cites the source lessons.
   Available as a CLI and a minimal web UI (KaTeX rendered, vendored offline).
3. **Grading** (`src/grading/`) — the crux. Normalizes LaTeX (`\frac`, `\sqrt`, `\pi`,
   `\binom`, `\log_b`…) to mathjs, then grades **numeric** answers by set-comparison
   within tolerance and **expression** answers by equivalence at random sample points
   (not `simplify()`). Validated 22/22 against the real answer keys.
4. **Eval** (`eval/run.ts`) — runs every problem in two modes, **closed-book** (question
   only) vs **open-book** (question + retrieved context), forces a parseable
   `ANSWER: <value>` line, grades with the module above, and writes a per-mode accuracy
   report to `eval-results/` (gitignored). Measures how much the context actually helps.

## Layout

```
course-pack/          local-only course material (gitignored; see its README)
sample-course/        bundled sample course (3 original lessons; fresh-clone fallback)
src/
  config.ts           all model/endpoint config from env
  ollama.ts           local chat + embeddings client
  grading/            LaTeX→mathjs + numeric/expression grading (the crux)
  rag/                chunk → embed → store → retrieve
  tutor/              ask() RAG chat + CLI
  server.ts           Bun server + SSE, Edge --app window (port 8720)
public/               vanilla chat UI + vendored KaTeX (offline)
eval/run.ts           two-mode (closed vs open book) harness + report
.env.example          model/endpoint config
```

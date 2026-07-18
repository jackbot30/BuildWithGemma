# BuildWithGemma

On-device AI built with Gemma for the *Just Build: Gemma Hackathon* (Jul 17–18, 2026).
Everything here runs locally via **Ollama** — no cloud inference, works with the network off.

This repository holds two related apps:

## [`math-sync/`](math-sync/) — offline Gemma math tutor
Load a course pack once, then it teaches, graphs, and **checks its own work** fully
offline. Streaming chat grounded in the course, a deterministic answer checker (the
Evidence engine), function graphing, and a raw-vs-tools eval. Ships a self-written
sample course; runs as a desktop-style Edge `--app` window with no compile step.
→ [`math-sync/README.md`](math-sync/README.md)

## [`gemma-course-tutor/`](gemma-course-tutor/) — local RAG tutor + rigorous eval
Retrieval-augmented tutoring over a real course pack, with a two-mode
(closed-book vs open-book) eval harness that measures how much the course context
actually helps. The grading module normalizes LaTeX and verifies answers with mathjs.
→ [`gemma-course-tutor/README.md`](gemma-course-tutor/README.md)

> ⚠️ **No copyrighted course content is committed.** `gemma-course-tutor` runs over a
> private, local-only course pack that is git-ignored; only an explanation ships. See
> [`gemma-course-tutor/course-pack/README.md`](gemma-course-tutor/course-pack/README.md).

## Model runtime
Gemma via Ollama at `http://localhost:11434`. Model tags are env-configurable
(`gemma4:e4b` is what these were developed against; swap freely). Embeddings use
`nomic-embed-text`. License: MIT (code only) — see [`math-sync/LICENSE`](math-sync/LICENSE).

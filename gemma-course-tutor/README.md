# gemma-course-tutor

A **local, on-device** study tool that answers questions from your own course material
using Gemma (via Ollama) with retrieval-augmented generation, and measures how much the
course context actually helps with a two-mode eval harness.

Everything runs locally. No course content is ever sent to a remote service.

## ⚠️ Course content is NOT in this repository

This app runs over a **course pack** — a syllabus, lesson markdown, and an eval set.
The pack used to develop it is **copyrighted personal study material** (BYU Independent
Study MATH 056) and is **deliberately excluded from git**. If you cloned this repo, the
`course-pack/` folder is empty except for an explanation.

- **Why it's excluded and what belongs there:** [`course-pack/README.md`](course-pack/README.md)
- **The `.gitignore` rule** keeps every file under `course-pack/` out of version control
  except that one explanation file.
- **Bring your own pack** in the documented shape and the app works unchanged.

This is intentional: the reason to run Gemma locally is precisely so private/copyrighted
study material never has to leave the device.

## Stack

bun + TypeScript, Biome for lint/format. Gemma served locally via **Ollama**
(`http://localhost:11434`). Config lives in `.env` (see `.env.example`).

## Status

🚧 Scaffolding in progress. The copyright boundary (this section) is set up first.
The RAG index, tutor, and eval harness are being built next — see the plan in the
project notes.

## Planned layout

```
course-pack/          local-only course material (gitignored; see its README)
src/
  grading/            reusable numeric-tolerance + expression-equivalence (the crux)
  rag/                chunk → embed → store → retrieve
  tutor/              RAG chat over Ollama
eval/                 two-mode (closed-book vs open-book) harness + report
.env.example          all model/endpoint config
```

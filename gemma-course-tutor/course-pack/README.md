# course-pack/ — not included in this repository

**This folder intentionally ships almost empty on GitHub.** Everything else that
belongs here — the syllabus, all 100 lesson files, the eval questions, and the raw
provenance — is **copyrighted course material** and is deliberately **excluded from
version control** by `.gitignore`. Only this README is tracked.

## Why

The course pack is a personal, local-only study copy of **BYU Independent Study —
MATH 056** (Agilix Buzz), extracted from the learner's own enrollment. It is **not
ours to publish**. Committing it — or uploading it to any remote API — would
redistribute copyrighted material, so the app is built to keep it **on-device only**
(the whole point of running Gemma locally via Ollama).

The `.gitignore` rule is:

```gitignore
/course-pack/*
!/course-pack/README.md
```

i.e. ignore everything in this folder except this explanation.

## What belongs here (locally)

To run the tutor and the eval, populate this folder (or point `COURSE_PACK_DIR` at
your own) with:

```
course-pack/
  syllabus.md            course outline (units → lessons)
  lessons/*.md           one markdown file per lesson; math as $...$ / $$...$$ LaTeX
  eval/problems.json     [{ "id", "question", "expected", "type" }] — answer keys are ground truth
  _raw/                  (optional) extraction provenance
```

Bring your own course pack in the same shape and the app works unchanged — nothing
about the code is specific to MATH 056.

## Privacy guarantee

None of this content is ever sent to a remote service. Retrieval, embeddings, and
chat all run locally against Ollama (`http://localhost:11434`). That is enforced by
design, not just policy.

# Decision log — Build with Gemma

One entry per this-way-vs-that-way call, dated, in the same commit as the code it
explains. Newest at the bottom.

## 2026-07-18 · Monorepo with two apps instead of a single math-sync repo

The plan called for a standalone `math-sync/` repo. During the Friday-night build the
real course export (BYU MATH 056 via Agilix Buzz) turned out rich enough to support a
retrieval + rigorous-eval app of its own, which doesn't fit math-sync's
"one folder of markdown, zero setup" story. Rather than two repos (two histories to
keep clean under the no-prior-code rule, two links for judges), both live here:
`math-sync/` and `gemma-course-tutor/`.

## 2026-07-18 · math-sync is the headline; gemma-course-tutor is the evidence annex

One product gets the 3-minute demo and the memorized pitch: **math-sync**. The judged
story (Value, Ease of Use, Enablement) is math-sync's; `gemma-course-tutor` exists to
strengthen the **Evidence & Evaluation** category — it proves the same approach on a
real, copyrighted course with a closed-book vs open-book eval, which the shippable
sample course can't honestly demonstrate. The writeup and demo lead with math-sync and
cite course-tutor's numbers; we do not demo two apps.

## 2026-07-18 · Embeddings via nomic-embed-text, not Gemma

gemma-course-tutor's retrieval uses `nomic-embed-text` (via Ollama, fully local).
Gemma 4 has no embedding endpoint in Ollama; nomic is small (274 MB), on-device, and
keeps the no-cloud guarantee intact. Gemma remains the core AI (all generation and
tutoring). Documented explicitly for the On-Device track rules — the track requires
Gemma inference on-device, which is unaffected.

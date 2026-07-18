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

## 2026-07-18 · Evidence tab reads pre-run results — no run-from-the-UI button

The Evidence tab shows eval runs from `eval/results.json` (written by `bun run eval`)
but deliberately has **no "run eval now" button**. A full run is minutes of model
inference on CPU; spawning that from the demo UI is a crash/hang risk mid-demo and
would tie up the one machine. So the tab is read-only over pre-run results, and
`bun run eval` writes the file incrementally (monitorable, interruption-safe). If we
ever want live runs, it should be a separate, cancellable, backgrounded job — not a
blocking spawn behind a button.

## 2026-07-18 · Eval harness fix: extract a forced ANSWER line, actually dispatch tools

The first live eval run (gemma4:e2b, Jul 18 early AM) produced garbage: extraction
took the raw last line of a markdown/LaTeX reply, so `got` was literally `**`,
`### Method`, or `$$m = \frac{8}{4}$$` while the model's math was visibly right in
the prose; tools mode also silently dropped every emitted tool call (no dispatch
loop) and `num_predict: 512` truncated replies before the final answer. Those two
runs were deleted from `results.json` — they document a harness bug, not the model.
Fix, mirroring `gemma-course-tutor`'s proven grading approach: both modes now demand
a final plain-form `ANSWER: <value>` line; `eval/extract.ts` (unit-tested, red→green
on the real failure cases) prefers that line and otherwise normalizes markdown/LaTeX
and takes the last parseable math line; tools mode runs the same dispatch loop +
empty-answer retry guard as `src/agent.ts`; `num_predict` is 1024 (agent.ts's value).
The deterministic checker (`src/checker.ts`) and its tolerances are untouched — the
grading bar did not move, only what gets handed to it.

## 2026-07-18 · Demo model: gemma4:e2b

Measured on the fixed harness, 10-problem set, CPU-only demo machine, temperature 0:

| model      | raw   | +tools | raw avg | +tools avg |
|------------|-------|--------|---------|------------|
| gemma4:e2b | 10/10 | 10/10  | 15.0 s  | 24.3 s     |
| gemma4:e4b | 10/10 | 10/10  | 23.3 s  | 56.9 s     |

Rule from the team plan: pick e2b if its with-tools pass rate is ≥ 9/10 or ≥ e4b's.
Both conditions hold (10/10, tie), and e2b is ~1.6x faster raw / ~2.3x faster with
tools, so **gemma4:e2b is the demo default** (`MATH_SYNC_MODEL` still swaps it).
Honesty notes: (1) raw mode already scores 10/10 on both models, so on this set the
checker's value is **proof of correctness** — the app can show every answer verified
against the key — rather than an accuracy lift; the differentiator stays "verifies
rather than claims," not "tools rescue wrong answers." (2) An earlier e2b attempt
the same night scored 1/10–0/10 and was discarded: that was the extraction bug above,
not the model.

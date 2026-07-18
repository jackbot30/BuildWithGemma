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

## 2026-07-18 · Calculator UI evaluates server-side, not client-side mathjs

The Calculator tab posts to `POST /api/calculate`, which reuses the same server-side
mathjs path as the model's `calculate` tool, instead of vendoring mathjs (~1.5 MB)
into the client. One tested implementation means the tool and the UI can never
disagree, and it stays offline — the server is local. The route is a lazy import in
one marked block of server.ts so the feature stays deletable.

## 2026-07-18 · Trace protocol: one end-of-turn trace event, not per-event streaming

The "What Gemma did" drawer is fed by a single `{type:"trace"}` SSE event emitted at
the end of each turn (rounds, tool calls with args/results/durations, checker
verdicts, tok/s from Ollama's eval_count/eval_duration), while the pre-existing
lightweight `tool` events keep providing live activity lines during the wait. Full
per-event trace streaming would have meant redesigning the client protocol mid-
hackathon for no demo gain. Traces also append to a gitignored `traces.log` (JSONL);
`MATH_SYNC_NUM_PREDICT` exists as a test-only knob (unset ⇒ shipped default 1024).

## 2026-07-18 · Overnight parallel build merged in fixed order with a gate per merge

course-nav, calculator, and trace were built by three parallel agents in isolated
worktrees off the same base, then merged onto main one at a time (nav → calc →
trace), each merge gated on: zero conflict markers, `bun test`, `tsc --noEmit`, a
booted server, and endpoint smoke tests — plus one live model turn after the final
merge (trace event + calculate tool verified end-to-end over SSE). Two cross-branch
seams were fixed at integration, not in the branches: `showView` now knows all four
views, and the lesson pane hides the calculator/trace views it couldn't know about.

## 2026-07-18 · Lesson images: download-and-localize, not hotlink or placeholder

The Buzz export left 349 image refs (92/100 lessons) pointing at iscontent.byu.edu —
broken in airplane mode and an external dependency in an "everything local" product.
Options were hotlink (breaks the offline guarantee), strip to alt-text placeholders
(loses the actual math diagrams), or download into the gitignored course pack. We
localize: `scripts/localize-course-images.ts` (unit-tested) downloads each unique URL
once into `<courseDir>/assets/` with a stable `<basename>-<urlhash>` name and rewrites
lessons to `assets/<name>`; the server serves them at `/course-asset/<name>` (flat
names only — traversal rejected); the renderer maps `assets/` images to that route and
degrades any still-external image to its alt text. Copyright footing is unchanged:
the images live with the already-local, already-gitignored course text, never in git.

## 2026-07-18 · Quizzes: Gemma composes, the checker grades — stated honestly

"Quiz me on 1.1" → Gemma reads the lesson (lookup_course) and calls `create_quiz`
with problems + expected answers. The key is therefore model-proposed — but every
STUDENT answer is graded deterministically by the existing checker, and the UI
says exactly that ("questions and key by Gemma — grading is deterministic, never
the model"). Answers never reach the client until earned: the quiz event carries
questions only; `/api/quiz/answer` reveals the expected value only after a correct
answer or the 3rd failed attempt (attempts tracked server-side). Validation is
fail-closed (unparseable expected → rejected back to the model to fix); when the
model invents a bogus problem `type`, the tool infers numeric/expression from the
expected value rather than dropping a gradeable problem (proven live — e2b sent
"multiple choice" on its first attempt).

## 2026-07-18 · Checker: normalize JS-isms; add an approximate tier (bar unmoved)

Live probes found two false-✗ bugs worth fixing before a judged demo: `Math.PI`
graded INCORRECT vs `pi` (mathjs parses it as an accessor), and `1.414` graded
INCORRECT vs `sqrt(2)` (default tolerance needs ~6 sig decimals — a textbook
"round to 3 places" answer failed). Fix: (1) normalize `Math.PI`/`Math.E`/
`Math.sqrt(`/`Math.abs(`/`**` before parsing; (2) an approximate tier — if exact/
symbolic fails but both sides agree within 0.1% relative, return equal:true with
`approx:true` so the UI can say "≈ correct (rounded)". The strict path and its
tolerances are unchanged; empty answers and parse failures now carry explicit
reasons instead of a silent INCORRECT.

## 2026-07-18 · verify_solution: substitution replaces the circular chat ✓

Three independent audits converged on the same finding: in the chat flow the model
called `check_answer` with its own answer as `expected` — a trivially-correct check
our own Trace tab exposed. Rather than hide the trace, we made verification real:
new `verify_solution(equation, proposed)` substitutes the proposed solutions into
the ORIGINAL equation via mathjs and compares LHS/RHS per solution — independent
ground truth, no key needed. The system prompt (rewritten terse, refusal rule
first) instructs verify-before-stating; `check_answer` remains for quiz/eval where
a real key exists, with its schema now forbidding self-checking. Badge wording is
truthful per path: "verified by substitution — deterministic, not the model" vs
"checked against the answer key". Live-proven twice (agent + post-merge): model
passed the original equation, not its own answer. Known limits (documented, not
hidden): prompt-only enforcement — the model can still skip the call on some runs;
single-variable equations only.

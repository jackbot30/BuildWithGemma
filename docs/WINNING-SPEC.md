# WINNING-SPEC — overnight build priorities (Sat ~3 AM)

Synthesis of three independent audits (rubric-gap, Gemma-loop quality, TDD coverage),
ranked by rubric points at risk. Rubric: Value 25 · Inputs 15 · Enablement 20 ·
Model 20 · Evidence 20. Everything here is S/M effort; the CUT list is binding.

## Convergent finding — the one thing that could sink us

**The chat ✓ is circular.** `check_answer` takes both `answer` and `expected` from
the model; live traces show `expected == answer`. The pitch's centerpiece claim
("verified against the answer key, not the model grading itself") is FALSE in the
chat flow and disprovable from our own Trace tab. (Evidence 20 + Model 20.)

## Build items (owner: overnight agents; gate: red/green TDD + full merge gate)

### S1 · verify_solution tool — genuinely independent verification (Evidence+Model, M)
New tool `verify_solution(equation, proposed)`: server substitutes the proposed
solution(s) into the original equation via mathjs and compares LHS/RHS at each
proposed value (multi-solution aware). No answer key needed; truly independent of
the model. Chat verdict badge → "✓ verified by substitution — deterministic, not
the model". check_answer stays for quiz/eval where a real key exists; its schema
description must say expected comes from course material, never the model's own
answer. System prompt: instruct verify_solution for equations, check_answer only
with a course-sourced key.

### S2 · Checker truth — fix the two live grading bugs (Evidence, S+M)
(a) Normalize JS-isms before parsing: `Math.PI`→`pi`, `Math.sqrt`→`sqrt`, `Math.E`→`e`,
`**`→`^`. (b) Approximate tier: if symbolic/exact fails but values agree within
0.1% relative, grade "approximately correct" (distinct verdict, shown honestly as
"≈ correct (rounded)"). Eval keeps strict grading — the approx tier is presentation
for student-typed answers (chat/quiz), so the measured bar doesn't silently move.
(c) NEW `checker.test.ts`: the ~8-test starter set from the audit (pi forms,
fractions vs decimals, set order, tolerance cliff, `y=` stripping, parse errors,
empty answer → explicit error not silent INCORRECT).

### S3 · Retrieval fix — lookup_course must find "1.1" (Value+Model, S)
course.ts scoring: include lesson id+title in scored text, weight title hits ~5x,
drop token length filter to >1 so "1.1"/"1" score, term-frequency not binary
presence. Tests with a 100-lesson-shaped fixture: "1.1", "coordinate plane",
"solve x^2 = 1" must rank the right lesson first.

### S4 · Demo resilience + truth-sync (Enablement+Value, S each)
- Stop button: AbortController on the chat fetch; "Ask"→"Stop" while streaming;
  composer re-enabled on abort; server sse() enqueue wrapped (client disconnect
  must not throw into the agent loop).
- Friendly Ollama-down error ("The on-device model isn't responding — check
  Ollama") instead of raw fetch error.
- keep_alive 30m consistently (streamChat currently 10m vs prewarm 30m).
- Agent retry turn strips tool schemas (no zombie tool rounds); history capped
  server-side (last 6 messages) for CPU latency.
- Lesson view "← Back to chat" button (cold judge currently feels stuck).
- Trace list shows the student's raw question, not the injected lesson blob.
- README truth-sync: 4 tools listed incl. calculate; root README e4b claim fixed
  to e2b decision; delete stale `TODO(sat)` in server.ts (contradicts decision log).
- calc.ts guard: non-finite results → explicit error, not `= Infinity`.

### S5 · Quiz feature (in flight on feat/quiz) — merge with wiring check
TDD audit flags: `create_quiz` pushes to `ctx.quizzes` but agent.ts may never
initialize/read it → quiz event may never reach the client. Verify at merge with
a live turn; add the missing wiring + tests if the branch didn't.

## Eligibility (HUMANS, morning — nothing below matters without these)
1. Kaggle team registration before 10:00 AM. 2. Airplane-mode proof on the demo
machine incl. an image-heavy lesson. 3. Writeup submitted by 2:30 PM (hard 3:00).
4. Pitch: fix "4-billion-parameter" → e2b; rehearse twice; soften or live-test the
"auto-recompute on ✗" claim.

## CUT LIST (binding — do not build tonight)
Games/streak layer · embeddings/RAG port into math-sync · restyle/themes beyond
tidy · run-eval-from-UI · re-running evals or adding eval problems (CPU reserved) ·
gemma-course-tutor work · chat persistence · markdown upgrades · multi-course ·
mobile · Ollama/SSE integration-test harness · fixing Math.PI by redesign (S2's
normalization covers the demo; deeper design filed as follow-up).

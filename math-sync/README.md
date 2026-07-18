# Math Sync

> Load your course once — then it **teaches, graphs, and checks its own work**
> anywhere on Earth with a power outlet. No internet, no account, no data leaving
> the machine. **Track: On-Device AI with Gemma 4.**

Math Sync is a math tutor you point at a folder of course material. From then on it
runs **fully offline** on local Gemma 4 (via Ollama), grounding every answer in your
lessons and **verifying each final answer deterministically** — not "the model says
it's right," but checked against an answer key.

---

## Quickstart

```bash
bun install
bun run vendor      # copy KaTeX + function-plot into public/vendor (offline assets)
ollama pull gemma4:e2b   # demo default; gemma4:e4b also works (MATH_SYNC_MODEL=gemma4:e4b)
bun run app         # starts the server + opens a desktop-style Edge window
```

`bun run app` launches Edge in `--app` mode (a chromeless standalone window) — it
feels like a native desktop app with **no compile step**. Prefer a browser tab? Use
`bun run server` and open <http://localhost:8710>. Install a Start Menu shortcut with
`bun run install-shortcut`.

Load a different course pack (e.g. your real, non-shipped course):

```bash
COURSE_DIR=./real-course bun run app
```

---

## 1. Value — the problem & who has it

A student (the demo user is on the team) studying from a specific course. Generic
chat tutors need internet and an account, leak your data to a server, don't know your
syllabus, and **confidently get math wrong with no way to check**. Math Sync is
grounded in *your* course, runs with the network off, and proves each answer.

## 2. Inputs & Data — data flow & privacy

```
course folder (syllabus.md + lessons/*.md)  ─┐
your question ───────────────────────────────┼─▶  on-device Gemma 4  ─▶  answer + ✓/✗ + graph
                                              │        (Ollama, local)
nothing is uploaded · nothing is stored off-device
```

The real course is copyrighted and **never committed** (`.gitignore`d); a self-written
`sample-course/` ships so the app works out of the box.

## 3. Enablement & Ease of Use

One `bun install` + `bun run app`. Answers stream token-by-token (never a frozen
screen), tool activity is shown live, and a non-developer can drive the whole flow.
Latency, measured on the demo machine (CPU-only, Jul 18 eval set): `gemma4:e2b`
averages ~15 s/problem raw and ~24 s with tools; `gemma4:e4b` averages ~23 s raw and
~57 s with tools. Both scored 10/10 in both modes, so the demo defaults to the faster
`gemma4:e2b` (`MATH_SYNC_MODEL=gemma4:e4b` to swap back; an NVIDIA machine is faster still).

## 4. Underlying Model — on-device Gemma 4

- **Model:** `gemma4:e2b` (default) / `gemma4:e4b`, run by **Ollama** on the demo laptop.
- **Beyond an API call:** a native function-calling loop (`lookup_course`,
  `verify_solution`, `calculate`, `plot`, `create_quiz`, `create_flashcards`) —
  Gemma orchestrates retrieval, verification, arithmetic, graphing, and study-material
  composition. (`check_answer` is deliberately NOT offered in chat: with no answer key
  in that flow it could only self-check; it serves the eval harness and quiz grading,
  which call it server-side with a real key.)
- **Airplane-mode proof:** disable Wi-Fi, then ask a question — it still answers. All
  front-end assets (KaTeX, function-plot) are vendored locally; zero CDN calls.

## 5. Evidence & Evaluation — it verifies itself

- In chat, `verify_solution` checks equation solutions by **substituting them into the
  original equation** via mathjs — independent ground truth, no key needed, never
  Gemma's own output. In the eval harness and quiz grading, `check_answer` grades
  against a real answer key at random sample points (see `src/checker.ts`).
- `bun run eval` runs the 10-problem set (`eval/problems.json`) **raw vs. +tools**,
  prints a pass-rate table, and writes each result to `eval/results.json`
  (incrementally, so a long run is monitorable and survives interruption).
- The in-app **Evidence tab** (Chat | Evidence switcher) reads `eval/results.json`
  and shows each run's pass rate, avg seconds/problem, and per-problem ✓/✗ with
  expected-vs-got — **failures are shown, not hidden** — so a judge can inspect the
  numbers without leaving the app. The shipped file also carries a clearly-labelled
  *quoted* pre-kickoff baseline (not re-run in this repo).
- **Honest limits:** the ✓/✗ covers final *computable* answers only — not proofs,
  word-problem reasoning, or "show your steps." Course conversion is manual today.

---

## Judge verification checklist

| Check | How |
|-------|-----|
| Local model | `ollama list` shows `gemma4:e2b`; inference runs on this laptop |
| Runtime | Ollama at `localhost:11434`, called from `src/ollama.ts` (native `/api/chat`) |
| Network-off | Turn off Wi-Fi → ask a question → still answers (badge shows "✈ offline") |
| Self-verification | Ask a solvable problem → ✓/✗ badge appears; run `bun run eval` |

## Repo layout

```
server.ts            Bun server: static UI, SSE chat, course + eval-results APIs, Edge --app
src/ollama.ts        native Ollama /api/chat streaming client
src/agent.ts         streaming tool-calling loop (capped, empty-answer guard)
src/tools.ts         lookup_course · verify_solution · calculate · plot · create_quiz · create_flashcards · check_answer(eval/quiz only)
src/checker.ts       deterministic verifier (random-point equality — the Evidence engine)
src/course.ts        course-pack loader (COURSE_DIR override)
public/              UI (index.html, app.js, style.css) + vendor/ (KaTeX, function-plot)
sample-course/       self-written mini course that ships (real course is .gitignore'd)
eval/                problems.json (answer keys) · run.ts (pass table + writes results) · results.ts (results store) · results.json (persisted runs, read by the Evidence tab)
```

## Team & license

Built at *Just Build: Gemma Hackathon* (Jul 17–18, 2026) by Jack, Leander & Luis.
MIT licensed (code only — see `LICENSE`). Gemma weights are under [Google's Gemma Terms
of Use](https://ai.google.dev/gemma/terms). **Kaggle Writeup:**
[`docs/kaggle-writeup.md`](../docs/kaggle-writeup.md) — **submission URL:** _TODO: paste the Kaggle link before 2:30 PM_.

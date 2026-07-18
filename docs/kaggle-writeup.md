# Math Sync — On-Device AI with Gemma 4

**Math Sync is a tutor you load your course into once — then it teaches, graphs, and
checks its own work, anywhere there's a power outlet.**

It runs Gemma 4 entirely on the local machine through Ollama: no cloud, no account, no data
leaving the device, and it keeps working with the network physically off. What makes it more
than a chat wrapper is that it **verifies its own answers deterministically** — a math engine
checks each result against the course answer key, so a green ✓ means *proven correct*, not
*the model says so*.

- **Repo:** https://github.com/jackbot30/BuildWithGemma (headline app in `math-sync/`)
- **Track:** On-Device AI with Gemma 4
- **Demo model:** `gemma4:e2b` via Ollama (local). `gemma4:e4b` also supported.
- **Team:** Jack, Leander & Luis

## Known limitations (stated first, on purpose)

- **It verifies computable final answers, not proofs.** Equation solutions, evaluations,
  and numeric/expression answers are checked; a multi-step geometry proof is not.
- **Course ingestion is manual today.** You convert a course to a folder of markdown by
  hand. Automating import from an LMS is the roadmap, not a shipped feature.
- **Small model on CPU is slow.** ~15 s/answer raw and ~24 s with tools on a CPU-only
  laptop. That's the floor we designed for (zero hardware assumptions); on any GPU/NPU it
  drops to seconds. The honest comparison at 11 PM with no internet isn't a fast cloud
  model — it's *nothing*.

## Value (problem & user)

A student studying from one specific course (the demo user is on the team). The
alternatives are a course forum nobody answers, or a generic cloud chatbot that needs
internet and an account, leaks what you're struggling with to a server, doesn't know your
syllabus, and **confidently gets math wrong with no way to check.** Math Sync is grounded
in *your* lessons, runs with the network off, keeps everything on the laptop, and never
shows you an answer it hasn't verified.

## Inputs & Data

- **In:** a folder of course material (syllabus + lesson markdown + an answer key for the
  eval set). Loaded once at boot.
- **Processed:** entirely on-device — lesson retrieval, the Gemma tool-calling loop, and
  the deterministic checker all run locally.
- **Out:** nothing. No telemetry, no account, no network egress. Provenance is visible in
  a Trace tab that shows every tool call, its arguments, and its result.
- **Failure handling:** if Ollama isn't reachable, the app fails loudly at boot with an
  actionable message instead of hanging mid-use.

## Enablement & Ease of Use

Runs as a desktop-style window (Edge `--app`) with no compile step; a student operates it
with no developer help. Answers stream token-by-token so it's never a frozen spinner, a
live tokens/sec + stage indicator shows progress, and there's a Stop button. The
verification badge (✓/✗) and an "✈ offline" banner give understandable, at-a-glance
feedback. Study aids — quizzes and flashcards with an SM-2 spaced-repetition deck — are
generated from the loaded course; missed questions roll into a review deck automatically.

## Underlying Model

Gemma 4 is the core of the product, used well beyond a single prompt: it drives a
**function-calling tool loop** (native Ollama `/api/chat` tool calls) over
`lookup_course`, `verify_solution`, `calculate`, `plot`, `create_quiz`, and
`create_flashcards`. The model decides *when* to pull the student's actual lesson, *when*
to graph, and *when* to check an answer; the app grounds it in the retrieved lesson and
scopes it to the loaded course (off-syllabus questions are declined, not hallucinated).
Deployed on-device via Ollama and verifiable with the network disabled, per the track rule.

## Evidence & Evaluation

The product **verifies its own results rather than claiming completion.** The checker is
independent ground truth: it substitutes solutions back into the original equation via
mathjs (and compares expressions by evaluating both at several random points, not by
symbolic `simplify`), so it never uses Gemma's own output to grade Gemma. We caught — and
fixed — a circular-verification bug during the build *because our own Trace tab exposed it*.

We measured on a real course-problem eval set, raw model vs. with-tools, and the scripts
ship in the repo (`bun run eval`):

| Run | Model | Mode | Pass | Avg / answer |
|-----|-------|------|------|--------------|
| Pre-build baseline (pre-kickoff, quoted) | gemma4:e4b | raw | 15/15 | 36–105 s |
| Final | gemma4:e2b | raw | 10/10 | 15.03 s |
| Final | gemma4:e2b | +tools | 10/10 | 24.30 s |
| Final | gemma4:e4b | raw | 10/10 | 23.32 s |
| Final | gemma4:e4b | +tools | 10/10 | 56.94 s |

Honest reading of these numbers: **raw accuracy is already 10/10, so the checker is not an
accuracy rescue — it's proof of correctness.** Its value is trust: when a small local model
*does* miss (and they do), the student sees a red ✗ and a recompute instead of confident
nonsense. We chose `gemma4:e2b` as the demo model because it matched `e4b`'s accuracy while
running ~2.3× faster with tools on CPU.

A companion app, `gemma-course-tutor/`, is a retrieval-augmented (RAG) tutor with a
closed-book vs. open-book eval harness that proves the same approach on a full, real
100-lesson course; its grader validates 22/22 against the real answer keys. (The
copyrighted course itself is not committed — the app ships a small self-written sample
course so it runs on a fresh clone.)

## How the model stack works (on-device)

1. **Runtime:** Gemma 4 served locally by **Ollama** at `localhost:11434`; the app calls
   the native `/api/chat` endpoint and streams tokens. No cloud inference anywhere.
2. **Grounding:** a lightweight retriever pulls the relevant lesson from the loaded course
   pack and passes it as context — the model answers from *your* material.
3. **Tools:** Gemma's function calling drives lesson lookup, graphing (a real plotting
   engine), and the checker; all tool code runs locally.
4. **Verification:** `verify_solution` / the checker independently confirm the final answer
   via mathjs before the ✓ badge appears.
5. **Offline:** all front-end assets (KaTeX, plotting) are vendored — zero CDN calls — so
   the whole thing runs in airplane mode.

## Repo & how to run

```bash
bun install
bun run vendor            # copy KaTeX + function-plot into public/vendor (offline)
ollama pull gemma4:e2b    # demo default (or MATH_SYNC_MODEL=gemma4:e4b)
bun run app               # server + desktop-style Edge --app window
```

**Verify it's on-device:** with the app open, turn off Wi-Fi and ask a question — it still
answers, and the badge shows "✈ offline." Run `bun run eval` to reproduce the table above.

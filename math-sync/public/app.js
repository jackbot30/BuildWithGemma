// Math Sync client. Streams the agent over SSE, renders KaTeX math, ✓/✗ verdicts,
// and function-plot graphs. Plain ES modules — no framework, no build step.

/** @typedef {{role:"user"|"assistant",content:string}} Turn */

const chat = document.getElementById("chat");
const form = document.getElementById("composer");
const input = /** @type {HTMLInputElement} */ (document.getElementById("input"));
const sendBtn = /** @type {HTMLButtonElement} */ (document.getElementById("send"));
const themeSel = /** @type {HTMLSelectElement} */ (document.getElementById("theme"));

/** @type {Turn[]} */
const history = [];

// --- Network badge: proves "still works offline" at a glance. ---
function refreshNetBadge() {
  const badge = document.getElementById("net-badge");
  if (!badge) return;
  const offline = !navigator.onLine;
  badge.textContent = offline ? "✈ offline — still working" : "online";
  badge.classList.toggle("offline", offline);
}
window.addEventListener("online", refreshNetBadge);
window.addEventListener("offline", refreshNetBadge);
refreshNetBadge();

// --- Theme picker (persisted). ---
const savedTheme = localStorage.getItem("theme") ?? "slate";
document.documentElement.dataset.theme = savedTheme;
themeSel.value = savedTheme;
themeSel.addEventListener("change", () => {
  document.documentElement.dataset.theme = themeSel.value;
  localStorage.setItem("theme", themeSel.value);
});

// --- Course label ---
fetch("/api/course")
  .then((r) => r.json())
  .then((c) => {
    const label = document.getElementById("course-label");
    if (label) label.textContent = `${c.lessons.length} lessons · ${c.model}`;
  })
  .catch(() => {});

// --- Heartbeat so the server auto-exits when the window closes. ---
setInterval(() => fetch("/api/heartbeat").catch(() => {}), 5000);

function renderMath(el) {
  if (window.renderMathInElement) {
    window.renderMathInElement(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
      ],
      throwOnError: false,
    });
  }
}

function addBubble(role) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  wrap.appendChild(bubble);
  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
  return bubble;
}

function addTrace(text) {
  const t = document.createElement("div");
  t.className = "tool-trace";
  t.textContent = text;
  chat.appendChild(t);
  chat.scrollTop = chat.scrollHeight;
}

function addPlot(spec) {
  const box = document.createElement("div");
  box.className = "plot";
  chat.appendChild(box);
  try {
    window.functionPlot({
      target: box,
      width: Math.min(560, chat.clientWidth - 60),
      height: 320,
      grid: true,
      xAxis: { domain: spec.domain },
      data: [{ fn: spec.fn, color: "#2563eb" }],
    });
  } catch (e) {
    box.textContent = `Could not plot ${spec.fn}: ${e}`;
  }
  chat.scrollTop = chat.scrollHeight;
}

async function ask(message) {
  history.push({ role: "user", content: message });
  addBubble("user").textContent = message;

  const bubble = addBubble("assistant");
  bubble.innerHTML = '<span class="spinner"></span>';
  let answer = "";
  let started = false;

  // Live rendering: run the accumulated answer through the same markdown + KaTeX
  // pipeline as lessons, throttled so we render at most every ~200ms while tokens
  // stream. Half-open `$…`/`**` may look plain for a beat; the done-render settles it.
  let renderTimer = null;
  function renderBubble() {
    const md = window.courseNav?.mdToHtml;
    if (!md) {
      bubble.textContent = answer;
      return;
    }
    const keep = [...bubble.querySelectorAll(".verdict, .trace-drawer, .quiz-card")]; // feat/quiz: keep quiz cards
    bubble.innerHTML = md(answer);
    bubble.classList.add("md");
    for (const el of keep) bubble.appendChild(el);
    renderMath(bubble);
    chat.scrollTop = chat.scrollHeight;
  }
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderBubble();
    }, 200);
  }

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // course-nav (feat/course-nav): one-shot lesson context for this turn.
    body: JSON.stringify({ message, history, lessonId: window.courseNav?.takeLessonContext?.() }),
  });
  if (!res.body) {
    bubble.textContent = "No response stream.";
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const line = frame.replace(/^data:\s*/, "");
      if (!line) continue;
      const ev = JSON.parse(line);
      handleEvent(ev);
    }
  }

  function handleEvent(ev) {
    switch (ev.type) {
      case "delta":
        if (!started) {
          bubble.innerHTML = "";
          started = true;
        }
        answer += ev.text;
        scheduleRender();
        break;
      case "tool":
        if (ev.name === "check_answer" && ev.phase === "result") {
          const ok = ev.detail.startsWith("CORRECT");
          const v = document.createElement("div");
          v.className = `verdict ${ok ? "ok" : "bad"}`;
          v.textContent = ok ? "✓ verified against the answer key" : "✗ check failed";
          bubble.appendChild(v);
        } else {
          const brief = ev.detail.length > 80 ? ev.detail.slice(0, 80) + "…" : ev.detail;
          const ms = ev.durationMs !== undefined ? ` (${ev.durationMs}ms)` : "";
          addTrace(`↳ ${ev.name} ${ev.phase === "call" ? "·" : "→"} ${brief}${ms}`);
        }
        break;
      case "trace":
        // Full per-turn trace (see trace.js) — the "What Gemma did" drawer.
        window.msTrace?.attachDrawer(bubble, ev.trace);
        break;
      case "plot":
        addPlot(ev.spec);
        break;
      case "quiz": // feat/quiz — all rendering lives in quiz.js
        window.msQuiz?.render(bubble, ev.quiz);
        break;
      case "done":
        if (ev.text && !answer) answer = ev.text;
        history.push({ role: "assistant", content: answer });
        // Final authoritative render (clears any half-open markdown/math).
        if (renderTimer) {
          clearTimeout(renderTimer);
          renderTimer = null;
        }
        if (answer) renderBubble();
        else bubble.textContent = "";
        break;
      case "error":
        bubble.textContent = `Error: ${ev.message}`;
        break;
    }
  }
  renderMath(bubble);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  sendBtn.disabled = true;
  input.disabled = true;
  try {
    await ask(message);
  } finally {
    sendBtn.disabled = false;
    input.disabled = false;
    input.focus();
  }
});

// --- Chat | Evidence tabs -------------------------------------------------
// Two views share one window: the chat + composer, and a read-only Evidence
// view backed by /api/eval/results. No run-from-the-UI button on purpose — the
// demo uses pre-run results (see docs/decisions/hackathon-log.md).

/**
 * @typedef {{ id:string, question:string, expected:string|string[], got:string, pass:boolean, seconds:number }} ProblemResult
 * @typedef {{ name:string, model:string, mode:"raw"|"tools", startedAt:string, done:boolean, problems:ProblemResult[], passRate:string, avgSeconds:number|null, note?:string }} Run
 */

const evidenceView = document.getElementById("evidence");
const composer = document.getElementById("composer");
const runsBox = document.getElementById("eval-runs");
const tabs = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll(".tab")]);

let evidenceLoaded = false;

const traceView = document.getElementById("trace-view"); // feat/trace

function showView(view) {
  const isChat = view !== "evidence" && view !== "calculator" && view !== "trace";
  chat.hidden = !isChat;
  composer.hidden = !isChat;
  if (evidenceView) evidenceView.hidden = view !== "evidence";
  const calculatorView = document.getElementById("calculator"); // feat/calculator
  if (calculatorView) calculatorView.hidden = view !== "calculator";
  if (traceView) traceView.hidden = view !== "trace"; // feat/trace
  for (const t of tabs) t.setAttribute("aria-selected", String(t.dataset.view === view));
  if (view === "evidence" && !evidenceLoaded) loadEvidence();
  if (view === "trace") window.msTrace?.loadTraceList(); // feat/trace — refresh each visit
}

for (const t of tabs) t.addEventListener("click", () => showView(t.dataset.view ?? "chat"));

function fmtDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function expectedText(expected) {
  return Array.isArray(expected) ? expected.join(", ") : String(expected);
}

/** Build one run card. Failures are shown, never hidden. */
function renderRun(run) {
  const card = document.createElement("div");
  card.className = "run-card";

  const head = document.createElement("div");
  head.className = "run-head";
  const title = document.createElement("div");
  title.className = "run-title";
  const modeTag = document.createElement("span");
  modeTag.className = `mode-tag ${run.mode}`;
  modeTag.textContent = run.mode === "tools" ? "+tools" : "raw";
  const nameEl = document.createElement("strong");
  nameEl.textContent = run.name;
  title.append(modeTag, nameEl);
  if (run.note) {
    const quoted = document.createElement("span");
    quoted.className = "quoted-tag";
    quoted.textContent = "quoted — not re-run here";
    title.appendChild(quoted);
  }
  if (!run.done) {
    const running = document.createElement("span");
    running.className = "running-tag";
    running.textContent = "in progress…";
    title.appendChild(running);
  }

  const meta = document.createElement("div");
  meta.className = "run-meta muted";
  const avg = run.avgSeconds == null ? "—" : `${run.avgSeconds}s/problem`;
  meta.textContent = `${run.model} · ${fmtDate(run.startedAt)} · pass ${run.passRate} · ${avg}`;
  head.append(title, meta);
  card.appendChild(head);

  if (run.note) {
    const note = document.createElement("p");
    note.className = "run-note";
    note.textContent = run.note;
    card.appendChild(note);
  }

  if (run.problems.length) {
    const table = document.createElement("table");
    table.className = "prob-table";
    const thead = document.createElement("thead");
    thead.innerHTML =
      "<tr><th></th><th>Problem</th><th>Expected</th><th>Got</th><th>s</th></tr>";
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const p of run.problems) {
      const tr = document.createElement("tr");
      tr.className = p.pass ? "pass" : "fail";
      const cells = [
        p.pass ? "✓" : "✗",
        p.question,
        expectedText(p.expected),
        p.got,
        String(p.seconds),
      ];
      for (let i = 0; i < cells.length; i++) {
        const td = document.createElement("td");
        td.textContent = cells[i];
        if (i === 0) td.className = "verdict-cell";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    card.appendChild(table);
  }

  return card;
}

async function loadEvidence() {
  if (!runsBox) return;
  evidenceLoaded = true;
  try {
    const res = await fetch("/api/eval/results");
    const data = /** @type {{ runs: Run[] }} */ (await res.json());
    runsBox.textContent = "";
    if (!data.runs || data.runs.length === 0) {
      runsBox.textContent = "No eval runs yet. Run `bun run eval` to generate results.";
      return;
    }
    // Group by model; within a model, raw before +tools so the pair sits side by side.
    const byModel = new Map();
    for (const run of data.runs) {
      if (!byModel.has(run.model)) byModel.set(run.model, []);
      byModel.get(run.model).push(run);
    }
    for (const [model, runs] of byModel) {
      runs.sort((a, b) => (a.mode === b.mode ? 0 : a.mode === "raw" ? -1 : 1));
      const group = document.createElement("div");
      group.className = "run-group";
      const h = document.createElement("h2");
      h.textContent = model;
      group.appendChild(h);
      const grid = document.createElement("div");
      grid.className = "run-grid";
      for (const run of runs) grid.appendChild(renderRun(run));
      group.appendChild(grid);
      runsBox.appendChild(group);
    }
  } catch (e) {
    runsBox.textContent = `Could not load results: ${e}`;
  }
}

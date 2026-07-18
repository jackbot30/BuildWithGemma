// App shell: intro, focus-mode navigation, math-sync backend integration.
// The backend owns course content, tutoring, verification, and quiz grading;
// this file renders what it sends and never re-implements its logic.

const starWrap = document.getElementById("starWrap");
const starVideo = document.getElementById("starVideo");
const view = document.getElementById("view");

let currentUnit = null; // null = home
let currentLessonId = null; // set while a lesson page is open; sent as chat context

// ---------- Intro ----------
// 1. Video plays alone for 1.5s.
// 2. Then the UI snaps into place.
// 3. Once everything has landed, the still-playing video fades to black
//    and the layer is dropped. No pause at any point while visible.

function runIntro() {
  starVideo.play().catch(() => {
    document.body.classList.remove("preflight");
    document.body.classList.add("arrive");
    starWrap.classList.add("gone");
  });

  setTimeout(() => {
    document.body.classList.remove("preflight");
    document.body.classList.add("arrive");
  }, 1500);

  setTimeout(() => starWrap.classList.add("fade-out"), 3200);
  setTimeout(() => {
    starWrap.classList.add("gone");
    starVideo.pause();
  }, 4900);
}

// ---------- Page transition: 1.2s fade ----------

let warping = false;

function warp(swap) {
  if (warping) return;
  warping = true;
  view.classList.add("page-out");
  setTimeout(() => {
    swap();
    view.classList.remove("page-out");
    warping = false;
  }, 600);
}

// ---------- HUD ----------
// Mission Control has no persistent chrome: the hero band carries the stats,
// so refreshing the HUD is a home re-render (a no-op on unit/lesson pages).

function refreshHud() {
  setSyncNote();
  if (currentUnit === null) renderHome();
}

function nextLesson() {
  for (let u = 0; u < course.units.length; u++) {
    const l = course.units[u].lessons.find((x) => !state.completed[x.id]);
    if (l) return { u, lesson: l };
  }
  return null;
}

// ---------- Markdown (lesson content from GET /api/course/lesson) ----------

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Small renderer for the backend's lesson markdown. Images use the backend's
// /course-asset route (localized by scripts/localize-course-images.ts);
// unreachable ones degrade to their alt text, same as math-sync's own UI.
function mdToHtml(md) {
  const lines = md.split("\n");
  const out = [];
  let para = [];
  let inCode = false;
  let listMode = null; // "ul" | "ol"

  const inline = (s) =>
    escapeHtml(s)
      .replace(/!\[([^\]]*)\]\((?:\.\/)?assets\/([^)\s]+)\)/g,
        '<img src="/course-asset/$2" alt="$1" onerror="this.outerHTML=this.alt">')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  const flushPara = () => {
    if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; }
  };
  const closeList = () => {
    if (listMode) { out.push("</" + listMode + ">"); listMode = null; }
  };

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("```")) {
      flushPara(); closeList();
      out.push(inCode ? "</pre>" : "<pre>");
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(escapeHtml(line)); continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara(); closeList();
      const level = Math.min(h[1].length + 1, 5);
      out.push("<h" + level + ">" + inline(h[2]) + "</h" + level + ">");
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const want = ul ? "ul" : "ol";
      if (listMode !== want) { closeList(); out.push("<" + want + ">"); listMode = want; }
      out.push("<li>" + inline((ul || ol)[1]) + "</li>");
      continue;
    }
    if (!line.trim()) { flushPara(); closeList(); continue; }
    para.push(line);
  }
  flushPara(); closeList();
  if (inCode) out.push("</pre>");
  return out.join("\n");
}

// KaTeX auto-render, vendored by the backend and reached through the proxy.
// When the backend is down the script never loads and this is a no-op.
function renderMathIn(el) {
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

// ---------- Pages ----------

// Mission Control home: dark hero band (progress ring, welcome, resume)
// over a grid of unit tiles that are the navigation.
function renderHome() {
  currentUnit = null;
  currentLessonId = null;
  document.getElementById("app").classList.remove("focus");
  const done = completedCount();
  const total = totalLessons();
  const pct = total ? Math.round((done / total) * 100) : 0;
  const next = nextLesson();

  let tiles = "";
  course.units.forEach((u, i) => {
    const uDone = unitCompleted(i);
    const uTotal = u.lessons.length;
    const isNext = next && next.u === i;
    const status =
      uDone === uTotal
        ? '<span class="tile-status complete">complete</span>'
        : isNext
        ? '<span class="tile-status up-next">' + uDone + "/" + uTotal + " · up next</span>"
        : '<span class="tile-status">' + uDone + "/" + uTotal + "</span>";
    tiles +=
      '<button class="unit-tile' + (isNext ? " next" : "") + '" data-u="' + i + '">' +
      "  <b>Unit " + (i + 1) + "</b>" +
      '  <span class="tile-sub">' + escapeHtml(u.title) + "</span>" +
      status +
      "</button>";
  });

  view.innerHTML =
    '<div class="pane unit-pane">' +
    '  <div class="home-hero">' +
    '    <div class="hero-ring" style="--pct:' + pct + '"><i>' + pct + "%</i></div>" +
    "    <div>" +
    '      <span class="unit-kicker">' +
    (course.source === "math-sync"
      ? "College Algebra · math-sync"
      : "College Algebra · offline course") +
    "</span>" +
    "      <h2>Welcome back, " + state.student + "</h2>" +
    '      <div class="hero-sub">' + done + " of " + total + " lessons · <b>" +
    state.points.toLocaleString() + "</b> points · <b>" + state.streak + "</b> day streak · <b>" +
    state.quizPassed + "</b> quiz passes</div>" +
    "    </div>" +
    (next ? '<button class="btn btn-gold hero-resume" id="continueBtn">Resume</button>' : "") +
    "  </div>" +
    '  <div class="unit-grid">' + tiles + "</div>" +
    "</div>";

  const cont = document.getElementById("continueBtn");
  if (cont) cont.onclick = () => goUnit(next.u);
  view.querySelectorAll("[data-u]").forEach((b) => {
    b.onclick = () => goUnit(Number(b.dataset.u));
  });
}

function crumbBar(u, lessonTitle) {
  return (
    '<div class="crumb-bar">' +
    '  <span class="crumbs">' +
    '    <button id="crumbHome">Home</button>' +
    '    <span class="crumb-sep">›</span>' +
    (lessonTitle
      ? '<button id="crumbUnit">Unit ' + (u + 1) + "</button>" +
        '<span class="crumb-sep">›</span><span>' + escapeHtml(lessonTitle) + "</span>"
      : "<span>Unit " + (u + 1) + "</span>") +
    "  </span>" +
    '  <span class="crumb-links"><button id="crumbTools">Tools</button><button id="crumbHelp">Help</button></span>' +
    "</div>"
  );
}

function wireCrumbs(u) {
  document.getElementById("crumbHome").onclick = goHome;
  const cu = document.getElementById("crumbUnit");
  if (cu) cu.onclick = () => goUnit(u);
  document.getElementById("crumbTools").onclick = openFormulas;
  document.getElementById("crumbHelp").onclick = openChat;
}

function renderUnit(u) {
  currentUnit = u;
  currentLessonId = null;
  document.getElementById("app").classList.add("focus");
  const unit = course.units[u];
  const total = unit.lessons.length;
  const done = unitCompleted(u);
  const firstOpen = unit.lessons.findIndex((l) => !state.completed[l.id]);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const stat = (v, cap) =>
    '<div class="band-stat"><b>' + v + "</b><span>" + cap + "</span></div>";

  let rows = "";
  unit.lessons.forEach((lesson, l) => {
    const isDone = !!state.completed[lesson.id];
    const isNext = l === firstOpen;
    rows +=
      '<div class="track-row">' +
      '  <div class="track-node' + (isDone ? " done" : isNext ? " next" : "") + '">' +
      (u + 1) + "." + (l + 1) + "</div>" +
      '  <button class="lesson-row" data-id="' + escapeHtml(lesson.id) + '">' +
      "    <h3>" + escapeHtml(lesson.title) + "</h3>" +
      (isDone
        ? '<span class="pill pill-gold">Read</span>'
        : isNext
        ? '<span class="pill pill-blue">Up next</span>'
        : "") +
      '    <span class="row-meta">Open lesson</span>' +
      "  </button>" +
      "</div>";
  });

  view.innerHTML =
    '<div class="pane unit-pane">' +
    crumbBar(u) +
    '  <div class="unit-band">' +
    '    <div class="band-left">' +
    '      <span class="unit-kicker">Unit ' + (u + 1) + " of " + course.units.length + "</span>" +
    "      <h2>" + escapeHtml(unit.title) + "</h2>" +
    '      <div class="band-track"><div class="band-fill" style="width:' + pct + '%"></div></div>' +
    "    </div>" +
    '    <div class="band-stats">' +
    stat(done + "/" + total, "lessons read") +
    stat(state.quizPassed, "quiz passes") +
    stat(state.points.toLocaleString(), "points") +
    stat(pct + "%", "complete") +
    "    </div>" +
    "  </div>" +
    '  <div class="lesson-track">' + rows + "</div>" +
    "</div>";

  wireCrumbs(u);
  view.querySelectorAll("[data-id]").forEach((b) => {
    b.onclick = () => goLesson(u, b.dataset.id);
  });
}

// Lesson page: content comes from the backend; reading it marks it complete.
async function renderLesson(u, id) {
  currentUnit = u;
  currentLessonId = id;
  document.getElementById("app").classList.add("focus");
  const meta = course.units[u].lessons.find((l) => l.id === id) || { title: id };

  view.innerHTML =
    '<div class="pane unit-pane">' +
    crumbBar(u, meta.title) +
    '  <div class="lesson-head">' +
    "    <h2>" + escapeHtml(meta.title) + "</h2>" +
    '    <button class="btn" id="askLessonBtn">Ask Gemma about this lesson</button>' +
    "  </div>" +
    '  <div class="lesson-content" id="lessonContent"><p class="muted">Loading lesson…</p></div>' +
    "</div>";

  wireCrumbs(u);
  document.getElementById("askLessonBtn").onclick = openChat;

  const box = document.getElementById("lessonContent");
  if (course.source !== "math-sync") {
    box.innerHTML =
      "<p>Lesson text lives in the math-sync backend, which isn't running.</p>" +
      "<p>Start it with <code>bun run server</code> in <code>BuildWithGemma/math-sync</code>, then use Tools › Sync with BYU.</p>";
    return;
  }
  try {
    const res = await fetch("/api/course/lesson?id=" + encodeURIComponent(id));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    box.innerHTML = mdToHtml(data.content || "");
    renderMathIn(box);
    if (markLessonOpened(id)) {
      refreshHud();
      toast("+50 points — " + meta.title + " marked read");
    }
  } catch (e) {
    box.innerHTML = "<p>Could not load this lesson: " + escapeHtml(String(e.message || e)) + "</p>";
  }
}

// ---------- Navigation ----------

function goHome() {
  if (currentUnit === null) return;
  warp(renderHome);
}

function goUnit(u) {
  warp(() => renderUnit(u));
}

function goLesson(u, id) {
  warp(() => renderLesson(u, id));
}

// ---------- Tools ----------

const toolsMenu = document.getElementById("toolsMenu");
document.getElementById("toolsBtn").onclick = (e) => {
  e.stopPropagation();
  toolsMenu.classList.toggle("hidden");
};
document.addEventListener("click", (e) => {
  if (!toolsMenu.classList.contains("hidden") && !toolsMenu.contains(e.target)) {
    toolsMenu.classList.add("hidden");
  }
});

function setSyncNote() {
  const note = document.getElementById("syncNote");
  note.textContent =
    course.source === "math-sync"
      ? "math-sync · " + totalLessons() + " lessons"
      : "offline course";
}

document.getElementById("syncBtn").onclick = async () => {
  toolsMenu.classList.add("hidden");
  document.getElementById("syncNote").textContent = "Syncing…";
  const res = await syncWithBYU();
  setSyncNote();
  if (res.ok) {
    toast("Synced with math-sync: " + res.lessons + " lessons.");
    currentUnit === null ? renderHome() : renderUnit(Math.min(currentUnit, course.units.length - 1));
  } else {
    toast("Backend not reachable. Start math-sync, then sync again.");
  }
};

function openFormulas() {
  toolsMenu.classList.add("hidden");
  const u = currentUnit === null ? 0 : currentUnit;
  const fallbackUnit = FALLBACK.units[u];
  document.getElementById("modalTitle").textContent =
    "Formulas · Unit " + (u + 1) + ": " + course.units[u].title;
  document.getElementById("modalBody").innerHTML =
    course.source === "offline" && fallbackUnit
      ? fallbackUnit.formulas.map(([name, f]) => "<h3>" + name + "</h3><code>" + f + "</code>").join("")
      : "<p>Formula sheets cover the built-in course. For the live course, ask Gemma — " +
        "it reads the lesson and verifies its math by substitution.</p>";
  document.getElementById("modal").classList.remove("hidden");
}
document.getElementById("formulaBtn").onclick = openFormulas;

// Calculator: POST /api/calculate reuses the backend's mathjs path — the same
// one the model's calculate tool runs, so the UI and the tutor can't disagree.
document.getElementById("calcBtn").onclick = () => {
  toolsMenu.classList.add("hidden");
  document.getElementById("modalTitle").textContent = "Calculator";
  document.getElementById("modalBody").innerHTML =
    '<form id="calcForm" class="calc-form">' +
    '  <input id="calcInput" type="text" placeholder="e.g. sqrt(2) * pi" autocomplete="off">' +
    '  <button class="btn" type="submit">Evaluate</button>' +
    "</form>" +
    '<div id="calcResult" class="calc-result"></div>';
  document.getElementById("modal").classList.remove("hidden");
  const input = document.getElementById("calcInput");
  input.focus();
  document.getElementById("calcForm").onsubmit = async (e) => {
    e.preventDefault();
    const expression = input.value.trim();
    if (!expression) return;
    const out = document.getElementById("calcResult");
    out.textContent = "…";
    try {
      const res = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expression }),
      });
      const data = await res.json();
      out.textContent = res.ok ? String(data.result) : (data.error || "HTTP " + res.status);
    } catch (err) {
      out.textContent = "Backend not running — no calculator without it.";
    }
  };
};

document.getElementById("resetBtn").onclick = () => {
  toolsMenu.classList.add("hidden");
  if (!confirm("Reset all local progress? Points, streak, and read lessons go back to the starting values.")) return;
  localStorage.removeItem("orbit-math");
  state = loadState();
  refreshHud();
  renderHome();
  toast("Progress reset.");
};

document.getElementById("modalClose").onclick = () =>
  document.getElementById("modal").classList.add("hidden");
document.getElementById("modal").onclick = (e) => {
  if (e.target.id === "modal") e.target.classList.add("hidden");
};

let toastId = null;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastId);
  toastId = setTimeout(() => t.classList.add("hidden"), 2600);
}

// ---------- Chat (math-sync agent over SSE) ----------
// POST /api/chat with { message, history, lessonId } and stream AgentEvents:
// delta | tool | plot | quiz | done | trace | error. Mirrors the backend's
// own client so verification badges and quizzes behave identically.

const chatDrawer = document.getElementById("chatDrawer");
const chatLog = document.getElementById("chatLog");
const chatHistory = []; // OllamaMessage[] — the backend caps it to the last 6

function openChat() {
  chatDrawer.classList.add("open");
  document.getElementById("chatModel").textContent =
    course.source === "math-sync"
      ? "math-sync · " + (course.model || "local model")
      : "offline — start math-sync for live tutoring";
  if (!chatLog.children.length) {
    addMsg("bot",
      "I'm the course tutor. I answer only from the loaded course, verify solutions by substitution, " +
      "and can quiz you — try \"Quiz me on " + (course.units[0].lessons[0] ? course.units[0].lessons[0].title : "the first lesson") + "\".");
  }
  document.getElementById("chatInput").focus();
}
document.getElementById("teacherBtn").onclick = openChat;
document.getElementById("chatClose").onclick = () => chatDrawer.classList.remove("open");

// Flashcards / SRS: opens the deck list + study overlay (window.orbitFlashcards
// is defined by the deferred module flashcards.js; resolved lazily at click).
document.getElementById("deckBtn").onclick = () => {
  if (window.orbitFlashcards) window.orbitFlashcards.openStudyOverlay();
  else toast("Flashcards module still loading — try again in a moment.");
};
document.getElementById("fcOverlayClose").onclick = () =>
  window.orbitFlashcards && window.orbitFlashcards.closeStudyOverlay();
document.getElementById("fcOverlay").onclick = (e) => {
  if (e.target.id === "fcOverlay" && window.orbitFlashcards) window.orbitFlashcards.closeStudyOverlay();
};

function addMsg(who, text) {
  const d = document.createElement("div");
  d.className = "msg " + who;
  d.textContent = text;
  chatLog.appendChild(d);
  chatLog.scrollTop = chatLog.scrollHeight;
  return d;
}

function addVerdict(bubble, ok, text) {
  const v = document.createElement("div");
  v.className = "verdict " + (ok ? "ok" : "bad");
  v.textContent = (ok ? "✓ " : "✗ ") + text;
  bubble.appendChild(v);
}

function addToolLine(bubble, text) {
  const t = document.createElement("div");
  t.className = "tool-line";
  t.textContent = text;
  bubble.appendChild(t);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// Quiz card: questions come from the SSE event (never the answers); grading
// goes through POST /api/quiz/answer, which reveals the key only after a
// correct answer or the third miss — all enforced server-side.
function renderQuiz(bubble, quiz) {
  const card = document.createElement("div");
  card.className = "quiz-card";
  card.innerHTML = "<h3>" + escapeHtml(quiz.title) + "</h3>";
  const score = document.createElement("p");
  score.className = "quiz-score";
  const solved = quiz.problems.map(() => false);
  const updateScore = () => {
    score.textContent = solved.filter(Boolean).length + "/" + quiz.problems.length + " verified";
  };
  updateScore();
  card.appendChild(score);

  quiz.problems.forEach((problem, index) => {
    const li = document.createElement("div");
    li.className = "quiz-problem";
    const q = document.createElement("div");
    q.className = "quiz-question";
    q.textContent = problem.question;
    renderMathIn(q);
    li.appendChild(q);

    const row = document.createElement("form");
    row.className = "quiz-answer-row";
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.placeholder = problem.type === "numeric" ? "e.g. 3 or -1, 2" : "e.g. 2x+1";
    const btn = document.createElement("button");
    btn.type = "submit";
    btn.className = "btn quiz-check";
    btn.textContent = "Check";
    row.append(input, btn);
    li.appendChild(row);

    const result = document.createElement("div");
    result.className = "quiz-result";
    li.appendChild(result);

    row.onsubmit = async (e) => {
      e.preventDefault();
      const answer = input.value.trim();
      if (!answer || btn.disabled) return;
      btn.disabled = true;
      try {
        const res = await fetch("/api/quiz/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quizId: quiz.id, index, answer }),
        });
        const r = await res.json();
        if (!res.ok) throw new Error(r.error || "HTTP " + res.status);
        if (r.pass) {
          solved[index] = true;
          input.disabled = true;
          result.className = "quiz-result ok";
          result.textContent = "✓ correct — " + r.normalized + " verified";
          updateScore();
          markQuizPass();
          refreshHud();
        } else {
          result.className = "quiz-result bad";
          result.textContent =
            r.expected !== undefined
              ? "✗ not quite — the answer was " + r.expected
              : "✗ " + r.normalized + " — try again (attempt " + r.attempts + ")";
        }
        // Loop-closer: a problem missed 3+ times becomes a "Missed questions"
        // SRS card. Decision + store live in the single-source modules.
        if (window.orbitMissed && window.orbitMissed.maybeAdd(problem.question, r)) {
          if (!li.querySelector(".quiz-missed-note")) {
            const note = document.createElement("p");
            note.className = "quiz-missed-note muted";
            note.textContent = "Added to your Missed questions deck →";
            li.appendChild(note);
          }
        }
      } catch (err) {
        result.className = "quiz-result bad";
        result.textContent = "Could not check: " + (err.message || err);
      } finally {
        btn.disabled = solved[index];
      }
    };
    card.appendChild(li);
  });

  const foot = document.createElement("p");
  foot.className = "quiz-foot";
  foot.textContent = "Questions by Gemma from your course — grading is deterministic, never the model.";
  card.appendChild(foot);
  bubble.appendChild(card);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// ---------- Live turn progress strip ----------
// Mirrors math-sync's progress: stage + round + elapsed clock during a turn.
// Driven by the "round" and "tool" SSE events (see handleEvent).

const chatProgress = document.getElementById("chatProgress");
const cpStage = document.getElementById("cpStage");
const cpRound = document.getElementById("cpRound");
const cpClock = document.getElementById("cpClock");
let progressTimer = null;

const TOOL_STAGE = {
  lookup_course: "looking up the course…",
  verify_solution: "verifying the solution by substitution…",
  calculate: "calculating…",
  plot: "drawing the graph…",
  create_quiz: "composing your quiz…",
  create_flashcards: "composing your flashcards…",
};

function progressStart() {
  if (!chatProgress) return;
  const t0 = Date.now();
  cpStage.textContent = "reading your question…";
  cpRound.textContent = "";
  cpClock.textContent = "0s";
  chatProgress.hidden = false;
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    cpClock.textContent = Math.round((Date.now() - t0) / 1000) + "s";
  }, 1000);
}
function progressSet(stage, round) {
  if (!chatProgress) return;
  if (stage) cpStage.textContent = stage;
  if (round !== undefined) cpRound.textContent = round;
}
function progressEnd() {
  if (!chatProgress) return;
  chatProgress.hidden = true;
  clearInterval(progressTimer);
  progressTimer = null;
}

// ---------- Send / Stop toggle ----------
// While a turn streams the Send button becomes Stop and aborts the fetch.

const chatSend = document.getElementById("chatSend");
let activeController = null; // set while a turn streams; lets Stop abort it.

function setStreaming(streaming) {
  if (streaming) {
    chatSend.textContent = "Stop";
    chatSend.type = "button"; // don't re-submit the form while streaming
    chatSend.classList.add("is-stop");
  } else {
    chatSend.textContent = "Send";
    chatSend.type = "submit";
    chatSend.classList.remove("is-stop");
  }
}

// In "Stop" mode the button is type=button and this aborts; in "Send" mode it's
// type=submit and the form's submit handler runs instead.
chatSend.addEventListener("click", () => {
  if (chatSend.type === "button" && activeController) activeController.abort();
});

document.getElementById("chatForm").onsubmit = async (e) => {
  e.preventDefault();
  const input = document.getElementById("chatInput");
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  addMsg("user", message);
  chatHistory.push({ role: "user", content: message });

  const bubble = addMsg("bot", "thinking…");
  bubble.classList.add("thinking");
  let answer = "";
  let started = false;
  let stopped = false;

  setStreaming(true);
  progressStart();

  const controller = new AbortController();
  activeController = controller;

  const finish = () => {
    bubble.classList.remove("thinking");
    if (answer) chatHistory.push({ role: "assistant", content: answer });
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  // Append a muted "— stopped —" note to the current bubble on abort.
  const markStopped = () => {
    if (stopped) return;
    stopped = true;
    bubble.classList.remove("thinking");
    if (!started) bubble.textContent = "";
    const note = document.createElement("span");
    note.className = "stopped-note muted";
    note.textContent = " — stopped —";
    bubble.appendChild(note);
    if (answer) chatHistory.push({ role: "assistant", content: answer });
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  const cleanup = () => {
    activeController = null;
    setStreaming(false);
    progressEnd();
  };

  let res;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        message,
        history: chatHistory.slice(0, -1),
        lessonId: currentLessonId || undefined,
      }),
    });
    if (!res.ok || !res.body) throw new Error("HTTP " + res.status);
  } catch (err) {
    if (controller.signal.aborted) markStopped();
    else {
      bubble.classList.remove("thinking");
      bubble.textContent =
        "The math-sync backend isn't running, so no live tutoring. Start it with " +
        "\"bun run server\" in BuildWithGemma\\math-sync. From local data: " + classStatsSummary();
    }
    cleanup();
    return;
  }

  const textNode = document.createTextNode("");
  const setAnswer = () => {
    if (!started) {
      bubble.classList.remove("thinking");
      bubble.textContent = "";
      bubble.appendChild(textNode);
      started = true;
    }
    textNode.textContent = answer;
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  const handleEvent = (ev) => {
    switch (ev.type) {
      case "round": // visible progress: which agent round we're on
        progressSet("thinking…", "round " + ev.round + "/" + ev.cap);
        break;
      case "delta":
        progressSet("writing the answer…");
        answer += ev.text;
        setAnswer();
        break;
      case "tool":
        if (ev.phase === "call") progressSet(TOOL_STAGE[ev.name] || ("using " + ev.name + "…"));
        if (ev.name === "verify_solution" && ev.phase === "result") {
          addVerdict(bubble, ev.detail.startsWith("VERIFIED"),
            ev.detail.startsWith("VERIFIED")
              ? "verified by substitution — deterministic, not the model"
              : "solution did not check out");
        } else if (ev.name === "check_answer" && ev.phase === "result") {
          addVerdict(bubble, ev.detail.startsWith("CORRECT"),
            ev.detail.startsWith("CORRECT") ? "checked against the answer key" : "check failed");
        } else if (ev.phase === "call") {
          addToolLine(bubble, "↳ " + ev.name + " · " +
            (ev.detail.length > 80 ? ev.detail.slice(0, 80) + "…" : ev.detail));
        }
        break;
      case "quiz":
        if (!started) setAnswer();
        renderQuiz(bubble, ev.quiz);
        break;
      case "flashcards": // render deck inline + save; SRS study via the deck CTA
        if (!started) setAnswer();
        if (window.orbitFlashcards) window.orbitFlashcards.render(bubble, ev.deck);
        else addToolLine(bubble, "(flashcards ready — open the Flashcards panel)");
        break;
      case "trace": // "What Gemma did" drawer — the tool-use evidence per answer
        if (window.orbitTrace) window.orbitTrace.attachDrawer(bubble, ev.trace);
        break;
      case "plot":
        addToolLine(bubble, "(graph available in the Math Sync app window)");
        break;
      case "done":
        if (ev.text && !answer) { answer = ev.text; setAnswer(); }
        finish();
        break;
      case "error":
        answer = answer || "Error: " + ev.message;
        setAnswer();
        finish();
        break;
    }
  };

  try {
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
        if (line) handleEvent(JSON.parse(line));
      }
    }
  } catch (err) {
    if (controller.signal.aborted) markStopped();
    else {
      if (!answer) { answer = "Connection lost mid-answer."; setAnswer(); }
      finish();
    }
  } finally {
    cleanup();
  }
};

// ---------- Boot ----------

// Heartbeat keeps math-sync alive: without pings it exits 30s after its last
// client leaves. Same 5s cadence as the backend's own UI. Harmless when down.
setInterval(() => fetch("/api/heartbeat").catch(() => {}), 5000);

renderHome();
setSyncNote();
runIntro();

// Load the real course as soon as the backend answers; re-render in place.
loadBackendCourse()
  .then(() => {
    state.lastSync = Date.now();
    saveState();
    setSyncNote();
    if (currentUnit === null) renderHome();
    else renderUnit(Math.min(currentUnit, course.units.length - 1));
    toast("Connected to math-sync: " + totalLessons() + " lessons loaded.");
  })
  .catch(() => setSyncNote());

// Course + state. The math-sync backend (BuildWithGemma) is the source of
// truth: units come from GET /api/course/outline, lesson content from
// GET /api/course/lesson, model info from GET /api/course. The built-in
// course below only covers for it when the backend isn't running.

const FALLBACK = {
  name: "College Algebra",
  code: "MATH 110",
  units: [
    {
      title: "Functions and graphs",
      lessons: [
        { id: "u1-1", title: "Evaluating functions" },
        { id: "u1-2", title: "Slope and lines" },
        { id: "u1-3", title: "Function review" },
      ],
      formulas: [
        ["Slope", "m = (y2 - y1) / (x2 - x1)"],
        ["Point-slope", "y - y1 = m(x - x1)"],
        ["Slope-intercept", "y = mx + b"],
      ],
    },
    {
      title: "Polynomials and factoring",
      lessons: [
        { id: "u2-1", title: "Expanding binomials" },
        { id: "u2-2", title: "Factoring quadratics" },
        { id: "u2-3", title: "Factoring review" },
      ],
      formulas: [
        ["Difference of squares", "a² - b² = (a + b)(a - b)"],
        ["Perfect square", "(a + b)² = a² + 2ab + b²"],
        ["Quadratic formula", "x = (-b ± √(b² - 4ac)) / 2a"],
      ],
    },
    {
      title: "Exponentials and logs",
      lessons: [
        { id: "u3-1", title: "Exponent rules" },
        { id: "u3-2", title: "Evaluating logs" },
        { id: "u3-3", title: "Log review" },
      ],
      formulas: [
        ["Product rule", "log(ab) = log a + log b"],
        ["Power rule", "log(aⁿ) = n · log a"],
        ["Change of base", "log_b(x) = ln x / ln b"],
      ],
    },
    {
      title: "Systems of equations",
      lessons: [
        { id: "u4-1", title: "Two-variable systems" },
        { id: "u4-2", title: "Substitution drills" },
        { id: "u4-3", title: "Systems review" },
      ],
      formulas: [
        ["Substitution", "Solve one equation for a variable, plug into the other"],
        ["Elimination", "Add or subtract equations to cancel a variable"],
      ],
    },
    {
      title: "Sequences and series",
      lessons: [
        { id: "u5-1", title: "Arithmetic sequences" },
        { id: "u5-2", title: "Geometric sequences" },
      ],
      formulas: [
        ["Arithmetic nth term", "a_n = a_1 + (n - 1)d"],
        ["Geometric nth term", "a_n = a_1 · r^(n-1)"],
        ["Arithmetic sum", "S_n = n(a_1 + a_n) / 2"],
      ],
    },
    {
      title: "Probability and counting",
      lessons: [
        { id: "u6-1", title: "Basic probability" },
        { id: "u6-2", title: "Counting review" },
      ],
      formulas: [
        ["Probability", "P(A) = favorable / total"],
        ["Complement", "P(not A) = 1 - P(A)"],
        ["Independent events", "P(A and B) = P(A) · P(B)"],
      ],
    },
  ],
};

// The live course. Starts as the fallback; loadBackendCourse() replaces it.
let course = { source: "offline", model: null, dir: null, units: FALLBACK.units };

// Backend shapes (see BuildWithGemma/math-sync/server.ts):
//   GET /api/course          -> { dir, model, lessons: [{id, title}] }
//   GET /api/course/outline  -> { units: [{title, lessons: [{id, title}]}] }
async function loadBackendCourse() {
  const [infoRes, outlineRes] = await Promise.all([
    fetch("/api/course"),
    fetch("/api/course/outline"),
  ]);
  if (!infoRes.ok || !outlineRes.ok) throw new Error("math-sync not reachable");
  const info = await infoRes.json();
  const outline = await outlineRes.json();
  if (!Array.isArray(outline.units) || outline.units.length === 0) {
    throw new Error("math-sync returned no units");
  }
  course = { source: "math-sync", model: info.model, dir: info.dir, units: outline.units };
  return course;
}

function totalLessons() {
  return course.units.reduce((n, u) => n + u.lessons.length, 0);
}

function unitCompleted(u) {
  return course.units[u].lessons.filter((l) => state.completed[l.id]).length;
}

function completedCount() {
  return course.units.reduce((n, _, i) => n + unitCompleted(i), 0);
}

// ---------- State ----------

const DEFAULT_STATE = {
  student: "Leander",
  points: 111760,
  streak: 578,
  // Lesson ids that were opened and read. Seeds cover the fallback course so
  // the demo starts at 6/16; backend lesson ids start clean.
  completed: { "u1-1": 1, "u1-2": 1, "u1-3": 1, "u2-1": 1, "u2-2": 1, "u2-3": 1 },
  quizPassed: 0,
  lastSync: null,
};

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem("orbit-math");
    if (raw) return Object.assign({}, DEFAULT_STATE, JSON.parse(raw));
  } catch (e) { /* corrupted or blocked storage, start over */ }
  return Object.assign({}, DEFAULT_STATE);
}

function saveState() {
  try { localStorage.setItem("orbit-math", JSON.stringify(state)); } catch (e) {}
}

function markLessonOpened(id) {
  if (state.completed[id]) return false;
  state.completed[id] = 1;
  state.points += 50;
  saveState();
  return true;
}

// Called when a quiz problem graded by POST /api/quiz/answer passes.
function markQuizPass() {
  state.quizPassed += 1;
  state.points += 100;
  saveState();
}

// Sync = refresh the course from math-sync, which holds the real BYU export.
async function syncWithBYU() {
  try {
    await loadBackendCourse();
    state.lastSync = Date.now();
    saveState();
    return { ok: true, source: "math-sync", lessons: totalLessons() };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// Plain-text stats summary; used by the chat fallback when the backend is down.
function classStatsSummary() {
  const perUnit = course.units
    .map((u, i) => u.title + ": " + unitCompleted(i) + "/" + u.lessons.length)
    .join("; ");
  return (
    "Student: " + state.student +
    ". Course source: " + course.source +
    ". Points: " + state.points +
    ". Daily streak: " + state.streak +
    ". Lessons read: " + completedCount() + " of " + totalLessons() +
    ". Quiz problems passed: " + state.quizPassed +
    ". Unit breakdown: " + perUnit + "."
  );
}

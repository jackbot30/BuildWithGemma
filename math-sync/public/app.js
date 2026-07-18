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

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
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
        bubble.textContent = answer;
        chat.scrollTop = chat.scrollHeight;
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
          addTrace(`↳ ${ev.name} ${ev.phase === "call" ? "·" : "→"} ${brief}`);
        }
        break;
      case "plot":
        addPlot(ev.spec);
        break;
      case "done":
        if (ev.text && !answer) bubble.textContent = ev.text;
        history.push({ role: "assistant", content: answer || ev.text });
        renderMath(bubble);
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

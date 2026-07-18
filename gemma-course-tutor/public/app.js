// Gemma Course Tutor client. Streams the RAG tutor over SSE, shows retrieved
// sources as citation chips, renders KaTeX math. Plain ES modules — no build step.

/** @typedef {{file:string, heading:string, lessonTitle:string, text:string}} StoredChunk */
/** @typedef {{chunk:StoredChunk, score:number}} Hit */

const chat = document.getElementById("chat");
const form = document.getElementById("composer");
const input = /** @type {HTMLInputElement} */ (document.getElementById("input"));
const sendBtn = /** @type {HTMLButtonElement} */ (document.getElementById("send"));

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

/** file › heading (falls back to lesson title). */
function sourceLabel(hit) {
  const c = hit.chunk || {};
  const head = c.heading || c.lessonTitle || "";
  return head ? `${c.file} › ${head}` : c.file;
}

/** @param {Hit[]} hits */
function addCitations(bubble, hits) {
  if (!hits || hits.length === 0) return;
  const box = document.createElement("div");
  box.className = "citations";
  hits.forEach((hit, i) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `[${i + 1}] ${sourceLabel(hit)}`;
    chip.title = `score ${Number(hit.score).toFixed(3)}`;
    box.appendChild(chip);
  });
  bubble.appendChild(box);
  chat.scrollTop = chat.scrollHeight;
}

async function ask(question) {
  addBubble("user").textContent = question;

  const bubble = addBubble("assistant");
  const status = document.createElement("div");
  status.className = "status";
  status.innerHTML = '<span class="spinner"></span> Searching course…';
  bubble.appendChild(status);

  const answerEl = document.createElement("div");
  answerEl.className = "answer";
  bubble.appendChild(answerEl);

  let answer = "";
  let citationsEl = null;

  const res = await fetch("/api/tutor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.body) {
    status.remove();
    answerEl.textContent = "No response stream.";
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
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      handleEvent(ev);
    }
  }

  function handleEvent(ev) {
    switch (ev.type) {
      case "context":
        addCitations(bubble, ev.hits);
        // Keep the (already-rendered) chips before the answer text.
        citationsEl = bubble.querySelector(".citations");
        if (citationsEl) bubble.insertBefore(citationsEl, answerEl);
        status.innerHTML = '<span class="spinner"></span> Thinking…';
        break;
      case "delta":
        if (status.parentNode) status.remove();
        answer += ev.text;
        answerEl.textContent = answer;
        chat.scrollTop = chat.scrollHeight;
        break;
      case "error":
        status.remove();
        answerEl.className = "answer error";
        answerEl.textContent = ev.message;
        break;
      case "done":
        if (status.parentNode) status.remove();
        renderMath(answerEl);
        break;
    }
  }
  if (status.parentNode) status.remove();
  renderMath(answerEl);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
  sendBtn.disabled = true;
  input.disabled = true;
  try {
    await ask(question);
  } catch (err) {
    addBubble("assistant").textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    sendBtn.disabled = false;
    input.disabled = false;
    input.focus();
  }
});

// course-nav (feat/course-nav): Units → Lessons sidebar + lesson viewer.
// TEMPORARY UI (restyle pending). All feature JS lives in this one file; the only
// hooks elsewhere are one script tag in index.html, a marked CSS block in
// style.css, and app.js reading window.courseNav.takeLessonContext() on send.
// Everything is local — no CDN/external URLs (airplane-mode requirement), except
// course diagrams hosted on the network, which render only in online mode (see
// syncNetworkImages) and stay as captions offline.

import { transformImages } from "./md-images.js";

/**
 * @typedef {{ id: string, title: string }} OutlineLesson
 * @typedef {{ title: string, lessons: OutlineLesson[] }} OutlineUnit
 */

const outlineBox = document.getElementById("course-outline");
const lessonView = document.getElementById("lesson-view");
const lessonTitle = document.getElementById("lesson-title");
const lessonContent = document.getElementById("lesson-content");
const askBtn = /** @type {HTMLButtonElement} */ (document.getElementById("ask-lesson"));
const backBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("back-to-chat"));
const chatEl = document.getElementById("chat");
const evidenceEl = document.getElementById("evidence");
const composerEl = document.getElementById("composer");
const inputEl = /** @type {HTMLInputElement|null} */ (document.getElementById("input"));

/** Lesson currently open in the viewer (null when none). */
let openLessonId = null;
let openLessonTitle = "";
/** Armed by "Ask about this lesson"; consumed by app.js for the NEXT question only. */
let pendingLessonId = null;

// app.js calls this when sending a chat turn; one-shot so only the next
// question carries the lesson context.
window.courseNav = {
  takeLessonContext() {
    const id = pendingLessonId;
    pendingLessonId = null;
    return id ?? undefined;
  },
  // Shared with app.js so finished chat answers render like lessons do.
  mdToHtml: (md) => mdToHtml(md),
};

// --- tiny markdown renderer (lessons are trusted local files, but escape anyway) ---

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function inlineMd(s) {
  // Images (local assets, offline-safe network placeholders, or alt-text) are
  // resolved by the shared, unit-tested transform; the rest is inline styling.
  return transformImages(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // links → plain text (no navigation)
}

/**
 * Hydrate network-image placeholders left by transformImages. Inserts the real
 * <img> only when the browser is online; offline (or if the image fails to load)
 * it keeps just the <figcaption>, so no external request is ever made in airplane
 * mode. Re-run on `online`/`offline` events to flip live.
 * @param {ParentNode} root
 */
function syncNetworkImages(root) {
  const online = navigator.onLine;
  for (const el of root.querySelectorAll("figure.net-img")) {
    const fig = /** @type {HTMLElement} */ (el);
    const url = fig.dataset.netSrc;
    const existing = fig.querySelector("img");
    if (online && url) {
      if (!existing) {
        const img = document.createElement("img");
        img.alt = fig.querySelector("figcaption")?.textContent ?? "";
        img.loading = "lazy";
        // On load failure (online but image unreachable) fall back to caption.
        img.addEventListener(
          "error",
          () => {
            img.remove();
            fig.classList.add("net-img--offline");
          },
          { once: true },
        );
        img.src = url;
        fig.insertBefore(img, fig.firstChild);
      }
      fig.classList.remove("net-img--offline");
    } else {
      existing?.remove();
      fig.classList.add("net-img--offline");
    }
  }
}

// Flip images live when connectivity changes, across lessons and chat answers.
window.addEventListener("online", () => syncNetworkImages(document.body));
window.addEventListener("offline", () => syncNetworkImages(document.body));

/** Minimal markdown → HTML: fences, headings, lists, blockquotes, paragraphs. */
function mdToHtml(md) {
  const out = [];
  const lines = escapeHtml(md).split("\n");
  let list = null; // "ul" | "ol" | null
  let inCode = false;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of lines) {
    if (/^```/.test(line)) {
      closeList();
      out.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(line);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const level = Math.min(h[1].length + 1, 5); // demote: lesson H1 → h2 (pane has its own h1)
      out.push(`<h${level}>${inlineMd(h[2])}</h${level}>`);
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      const want = ul ? "ul" : "ol";
      if (list !== want) {
        closeList();
        out.push(`<${want}>`);
        list = want;
      }
      out.push(`<li>${inlineMd((ul ?? ol)[1])}</li>`);
      continue;
    }
    closeList();
    if (/^\s*&gt;\s?/.test(line)) {
      out.push(`<blockquote>${inlineMd(line.replace(/^\s*&gt;\s?/, ""))}</blockquote>`);
    } else if (line.trim() !== "") {
      out.push(`<p>${inlineMd(line)}</p>`);
    }
  }
  closeList();
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

// --- view switching (cooperates with app.js's Chat | Evidence tabs) ---

function showLessonView() {
  if (chatEl) chatEl.hidden = true;
  if (evidenceEl) evidenceEl.hidden = true;
  if (composerEl) composerEl.hidden = true;
  // Views merged from sibling branches — hide them too when opening a lesson.
  const calculatorEl = document.getElementById("calculator");
  if (calculatorEl) calculatorEl.hidden = true;
  const traceEl = document.getElementById("trace-view");
  if (traceEl) traceEl.hidden = true;
  const fcEl = document.getElementById("flashcards-view");
  if (fcEl) fcEl.hidden = true;
  if (lessonView) lessonView.hidden = false;
  for (const t of document.querySelectorAll(".tab")) t.setAttribute("aria-selected", "false");
}

function backToChat() {
  if (lessonView) lessonView.hidden = true;
  if (evidenceEl) evidenceEl.hidden = true;
  if (chatEl) chatEl.hidden = false;
  if (composerEl) composerEl.hidden = false;
  for (const t of document.querySelectorAll(".tab")) {
    t.setAttribute("aria-selected", String(t.getAttribute("data-view") === "chat"));
  }
}

// app.js's tab handler shows chat/evidence; we just hide the lesson pane too.
for (const t of document.querySelectorAll(".tab")) {
  t.addEventListener("click", () => {
    if (lessonView) lessonView.hidden = true;
  });
}

// --- lesson loading ---

async function openLesson(id) {
  const res = await fetch(`/api/course/lesson?id=${encodeURIComponent(id)}`);
  if (!res.ok) {
    if (lessonContent) lessonContent.textContent = `Could not load lesson "${id}".`;
    showLessonView();
    return;
  }
  const lesson = /** @type {{ id: string, title: string, content: string }} */ (await res.json());
  openLessonId = lesson.id;
  openLessonTitle = lesson.title;
  if (lessonTitle) lessonTitle.textContent = lesson.title;
  if (lessonContent) {
    lessonContent.innerHTML = mdToHtml(lesson.content);
    syncNetworkImages(lessonContent); // load diagrams if online; captions if not
    if (window.renderMathInElement) {
      window.renderMathInElement(lessonContent, {
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
  for (const b of document.querySelectorAll(".lesson-link")) {
    b.classList.toggle("active", b.getAttribute("data-id") === id);
  }
  showLessonView();
}

// Plain exit from the lesson viewer back to the chat (no lesson context armed).
backBtn?.addEventListener("click", () => backToChat());

askBtn?.addEventListener("click", () => {
  if (!openLessonId) return;
  pendingLessonId = openLessonId;
  backToChat();
  if (inputEl) {
    inputEl.placeholder = `Ask about “${openLessonTitle}”…`;
    inputEl.focus();
  }
});

// --- sidebar ---

async function loadOutline() {
  if (!outlineBox) return;
  try {
    const res = await fetch("/api/course/outline");
    const data = /** @type {{ units: OutlineUnit[] }} */ (await res.json());
    outlineBox.textContent = "";
    if (!data.units?.length) {
      outlineBox.textContent = "No lessons in this course pack.";
      return;
    }
    for (const unit of data.units) {
      const details = document.createElement("details");
      details.open = true; // collapsible via native <details>
      details.className = "unit";
      const summary = document.createElement("summary");
      summary.textContent = unit.title;
      details.appendChild(summary);
      const ul = document.createElement("ul");
      ul.className = "lesson-list";
      for (const lesson of unit.lessons) {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "lesson-link";
        btn.dataset.id = lesson.id;
        btn.textContent = lesson.title;
        btn.addEventListener("click", () => openLesson(lesson.id));
        li.appendChild(btn);
        ul.appendChild(li);
      }
      details.appendChild(ul);
      outlineBox.appendChild(details);
    }
  } catch (e) {
    outlineBox.textContent = `Could not load outline: ${e}`;
  }
}

loadOutline();

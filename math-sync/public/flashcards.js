// feat/flashcards: renders a flip-through flashcard deck in chat + Anki TSV export.
// TEMPORARY UI (restyle pending). All feature JS lives here; hooks elsewhere are one
// script tag in index.html, one case in app.js, one marked CSS block in style.css.
// Everything local — no CDN/external URLs (airplane-mode requirement).

/** @typedef {{ front: string, back: string }} Flashcard */
/** @typedef {{ title: string, cards: Flashcard[] }} FlashcardDeck */

function renderMathIn(el) {
  if (window.renderMathInElement) {
    window.renderMathInElement(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
      ],
      throwOnError: false,
    });
  }
}

/** Anki plain-text import: front<TAB>back per line (tabs/newlines inside → spaces). */
function toAnkiTsv(cards) {
  const clean = (s) => s.replace(/[\t\n\r]+/g, " ").trim();
  return cards.map((c) => `${clean(c.front)}\t${clean(c.back)}`).join("\n");
}

function render(bubble, deck) {
  if (!deck?.cards?.length) return;
  let i = 0;
  let showingBack = false;

  const box = document.createElement("div");
  box.className = "flashcard-deck";

  const head = document.createElement("div");
  head.className = "fc-head";
  const title = document.createElement("strong");
  title.textContent = deck.title;
  const counter = document.createElement("span");
  counter.className = "muted fc-counter";
  head.append(title, counter);

  const card = document.createElement("button");
  card.type = "button";
  card.className = "fc-card";
  card.setAttribute("aria-label", "Flip card");
  const face = document.createElement("div");
  face.className = "fc-face";
  const hint = document.createElement("div");
  hint.className = "muted fc-hint";
  card.append(face, hint);

  const nav = document.createElement("div");
  nav.className = "fc-nav";
  const prev = document.createElement("button");
  prev.type = "button";
  prev.textContent = "← Prev";
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "Next →";
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "fc-export";
  exportBtn.textContent = "⬇ Export for Anki";
  nav.append(prev, next, exportBtn);

  const foot = document.createElement("p");
  foot.className = "muted fc-foot";
  foot.textContent =
    "Cards by Gemma from your course · export imports directly into Anki (File → Import, tab-separated).";

  function show() {
    const c = deck.cards[i];
    counter.textContent = `${i + 1} / ${deck.cards.length}`;
    face.textContent = showingBack ? c.back : c.front;
    card.classList.toggle("back", showingBack);
    hint.textContent = showingBack ? "answer — click to see front" : "click to flip";
    prev.disabled = i === 0;
    next.disabled = i === deck.cards.length - 1;
    renderMathIn(face);
  }

  card.addEventListener("click", () => {
    showingBack = !showingBack;
    show();
  });
  prev.addEventListener("click", () => {
    if (i > 0) i--;
    showingBack = false;
    show();
  });
  next.addEventListener("click", () => {
    if (i < deck.cards.length - 1) i++;
    showingBack = false;
    show();
  });
  exportBtn.addEventListener("click", () => {
    const blob = new Blob([toAnkiTsv(deck.cards)], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${deck.title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "flashcards"}-anki.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  box.append(head, card, nav, foot);
  bubble.appendChild(box);
  show();
}

window.msFlashcards = { render };

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

// --- saved decks (localStorage; local machine only, consistent with "nothing leaves") ---
const STORE_KEY = "ms-flashcard-decks";
const MAX_DECKS = 20;

function loadDecks() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveDeck(deck) {
  const decks = loadDecks();
  decks.unshift({ ...deck, savedAt: new Date().toISOString() });
  localStorage.setItem(STORE_KEY, JSON.stringify(decks.slice(0, MAX_DECKS)));
}

function deleteDeck(index) {
  const decks = loadDecks();
  decks.splice(index, 1);
  localStorage.setItem(STORE_KEY, JSON.stringify(decks));
}

/** Build the flip-deck DOM (used both inline in chat and in the Flashcards tab). */
function buildDeck(deck) {
  if (!deck?.cards?.length) return null;
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
  show();
  return box;
}

/** Chat entry point: render inline under the assistant bubble AND save to the tab. */
function render(bubble, deck) {
  const box = buildDeck(deck);
  if (!box) return;
  saveDeck(deck);
  bubble.appendChild(box);
}

/** Flashcards tab: list saved decks, newest first; open/export/delete per deck. */
function renderList() {
  const listEl = document.getElementById("fc-deck-list");
  if (!listEl) return;
  const decks = loadDecks();
  listEl.textContent = "";
  if (decks.length === 0) {
    listEl.textContent = "No decks yet — ask in chat: \"create flashcards for lesson 1.1\".";
    return;
  }
  decks.forEach((deck, index) => {
    const row = document.createElement("div");
    row.className = "fc-deck-row";
    const head = document.createElement("div");
    head.className = "fc-row-head";
    const label = document.createElement("button");
    label.type = "button";
    label.className = "fc-row-open";
    const when = deck.savedAt ? new Date(deck.savedAt).toLocaleString() : "";
    label.innerHTML = `<strong></strong> <span class="muted"></span>`;
    label.querySelector("strong").textContent = deck.title;
    label.querySelector("span").textContent = `· ${deck.cards.length} cards${when ? ` · ${when}` : ""}`;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "fc-row-del";
    del.textContent = "✕";
    del.setAttribute("aria-label", `Delete deck ${deck.title}`);
    head.append(label, del);
    row.appendChild(head);

    let opened = null;
    label.addEventListener("click", () => {
      if (opened) {
        opened.remove();
        opened = null;
        return;
      }
      opened = buildDeck(deck);
      if (opened) row.appendChild(opened);
    });
    del.addEventListener("click", () => {
      deleteDeck(index);
      renderList();
    });
    listEl.appendChild(row);
  });
}

window.msFlashcards = { render, renderList };

// orbit-integration-B: flashcards + SRS for Orbit's chat drawer.
//
// Scheduling is NOT reimplemented here — it imports the SAME pure module the
// math-sync UI and the Bun tests use (public/srs.js, served at /srs.js by the
// one-process server). This file only owns DOM: an inline flip-deck under a
// chat answer, a saved-decks panel, and an Anki-style study session that
// persists SRS state to localStorage after every grade.
//
// Decks live under the SAME localStorage key math-sync uses ("ms-flashcard-decks"),
// so a deck created here studies identically in either UI. Everything local —
// no external URLs (airplane-mode rule).

import { newCardState, grade, buildQueue, previewIntervals } from "/srs.js";

/** @typedef {{ front: string, back: string, srs?: object }} Flashcard */
/** @typedef {{ title: string, cards: Flashcard[], savedAt?: string }} FlashcardDeck */

const STORE_KEY = "ms-flashcard-decks";
const MAX_DECKS = 20;

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

function toAnkiTsv(cards) {
  const clean = (s) => s.replace(/[\t\n\r]+/g, " ").trim();
  return cards.map((c) => `${clean(c.front)}\t${clean(c.back)}`).join("\n");
}

function loadDecks() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function persistDecks(decks) {
  localStorage.setItem(STORE_KEY, JSON.stringify(decks));
}

function saveDeck(deck) {
  const decks = loadDecks();
  decks.unshift({ ...deck, savedAt: new Date().toISOString() });
  persistDecks(decks.slice(0, MAX_DECKS));
}

function deleteDeck(index) {
  const decks = loadDecks();
  decks.splice(index, 1);
  persistDecks(decks);
}

function dueCount(deck, now) {
  return buildQueue(deck.cards, now, 20).length;
}

function sizeClassFor(text) {
  if (text.length > 220) return "study-long";
  if (text.length > 90) return "study-med";
  return "study-big";
}

/** Inline flip-deck DOM (chat answer + panel preview). */
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
  counter.className = "fc-counter muted";
  head.append(title, counter);

  const card = document.createElement("button");
  card.type = "button";
  card.className = "fc-card";
  card.setAttribute("aria-label", "Flip card");
  const face = document.createElement("div");
  face.className = "fc-face";
  const hint = document.createElement("div");
  hint.className = "fc-hint muted";
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

  function show() {
    const c = deck.cards[i];
    counter.textContent = `${i + 1} / ${deck.cards.length}`;
    const text = showingBack ? c.back : c.front;
    face.className = `fc-face ${sizeClassFor(text)}`;
    face.textContent = text;
    card.classList.toggle("back", showingBack);
    hint.textContent = showingBack ? "answer — click to see front" : "click to flip";
    prev.disabled = i === 0;
    next.disabled = i === deck.cards.length - 1;
    renderMathIn(face);
  }

  card.addEventListener("click", () => { showingBack = !showingBack; show(); });
  prev.addEventListener("click", () => { if (i > 0) i--; showingBack = false; show(); });
  next.addEventListener("click", () => { if (i < deck.cards.length - 1) i++; showingBack = false; show(); });
  exportBtn.addEventListener("click", () => {
    const blob = new Blob([toAnkiTsv(deck.cards)], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${deck.title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "flashcards"}-anki.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  box.append(head, card, nav);
  show();
  return box;
}

/** Chat entry point: render inline under the assistant bubble AND save to the panel. */
function renderInChat(bubble, deck) {
  const box = buildDeck(deck);
  if (!box) return;
  saveDeck(deck);
  bubble.appendChild(box);
}

/**
 * Anki-style study session. Works through the due queue with Again/Hard/Good/
 * Easy; persists scheduling to localStorage after every grade (single source:
 * grade()/buildQueue()/previewIntervals() from /srs.js).
 */
function startStudy(host, decks, deckIndex, onExit) {
  const deck = decks[deckIndex];
  const queue = buildQueue(deck.cards, Date.now(), 20);

  host.textContent = "";
  const stage = document.createElement("div");
  stage.className = "study-stage";
  host.appendChild(stage);

  const bar = document.createElement("div");
  bar.className = "study-bar";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "study-back";
  back.textContent = "← Decks";
  back.addEventListener("click", () => onExit());
  const title = document.createElement("strong");
  title.textContent = deck.title;
  const counts = document.createElement("span");
  counts.className = "muted";
  bar.append(back, title, counts);

  const meter = document.createElement("div");
  meter.className = "study-meter";
  const meterFill = document.createElement("div");
  meterFill.className = "study-meter-fill";
  meter.appendChild(meterFill);

  const face = document.createElement("div");
  face.className = "study-face";
  const showBtn = document.createElement("button");
  showBtn.type = "button";
  showBtn.className = "study-show btn";
  showBtn.textContent = "Show answer";
  const grades = document.createElement("div");
  grades.className = "study-grades";
  grades.hidden = true;

  stage.append(bar, meter, face, showBtn, grades);

  if (queue.length === 0) {
    face.textContent = "Nothing due in this deck right now 🎉";
    face.className = "study-face study-big";
    showBtn.hidden = true;
    return;
  }

  let i = 0;
  let reviewed = 0;
  const initialTotal = queue.length;

  function showCard() {
    counts.textContent = `${Math.min(i + 1, queue.length)} / ${queue.length}`;
    meterFill.style.width = `${Math.min(100, Math.round((i / Math.max(queue.length, initialTotal)) * 100))}%`;
    if (i >= queue.length) {
      face.className = "study-face study-big";
      face.textContent = `Session done — ${reviewed} card${reviewed === 1 ? "" : "s"} reviewed. 🎉`;
      meterFill.style.width = "100%";
      showBtn.hidden = true;
      grades.hidden = true;
      return;
    }
    const card = queue[i];
    if (!card.srs) counts.textContent += " · new";
    face.className = `study-face ${sizeClassFor(card.front)}`;
    face.textContent = card.front;
    renderMathIn(face);
    showBtn.hidden = false;
    grades.hidden = true;
  }

  showBtn.addEventListener("click", () => {
    const card = queue[i];
    face.className = `study-face ${sizeClassFor(card.front + card.back)}`;
    face.textContent = "";
    const q = document.createElement("div");
    q.className = "study-q";
    q.textContent = card.front;
    const hr = document.createElement("hr");
    const a = document.createElement("div");
    a.className = "study-a";
    a.textContent = card.back;
    face.append(q, hr, a);
    renderMathIn(face);
    showBtn.hidden = true;
    grades.hidden = false;
    grades.textContent = "";
    const previews = previewIntervals(card.srs, Date.now());
    for (const rating of ["again", "hard", "good", "easy"]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `study-grade study-${rating}`;
      b.innerHTML = `${rating[0].toUpperCase()}${rating.slice(1)}<br><span class="muted">${previews[rating]}</span>`;
      b.addEventListener("click", () => {
        const nowMs = Date.now();
        card.srs = grade(card.srs ?? newCardState(nowMs), rating, nowMs);
        persistDecks(decks); // persist scheduling immediately
        reviewed++;
        if (card.srs.phase === "learning" && (rating === "again" || rating === "hard")) queue.push(card);
        i++;
        showCard();
      });
      grades.appendChild(b);
    }
  });

  showCard();
}

/** Saved-decks panel: list newest-first with open / study / export / delete. */
function renderPanel(host) {
  const decks = loadDecks();
  host.textContent = "";

  if (decks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted fc-empty";
    empty.textContent = 'No decks yet — ask in chat: "create flashcards for this lesson".';
    host.appendChild(empty);
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
    const strong = document.createElement("strong");
    strong.textContent = deck.title;
    const meta = document.createElement("span");
    meta.className = "muted";
    const when = deck.savedAt ? new Date(deck.savedAt).toLocaleString() : "";
    meta.textContent = ` · ${deck.cards.length} cards${when ? ` · ${when}` : ""}`;
    label.append(strong, meta);

    const study = document.createElement("button");
    study.type = "button";
    study.className = "fc-row-study btn";
    const due = dueCount(deck, Date.now());
    study.textContent = due > 0 ? `Study (${due})` : "Study";
    study.disabled = due === 0;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "fc-row-del";
    del.textContent = "✕";
    del.setAttribute("aria-label", `Delete deck ${deck.title}`);

    head.append(label, study, del);
    row.appendChild(head);

    let opened = null;
    label.addEventListener("click", () => {
      if (opened) { opened.remove(); opened = null; return; }
      opened = buildDeck(deck);
      if (opened) row.appendChild(opened);
    });
    study.addEventListener("click", () => {
      startStudy(host, decks, index, () => renderPanel(host));
    });
    del.addEventListener("click", () => { deleteDeck(index); renderPanel(host); });

    host.appendChild(row);
  });
}

window.orbitFlashcards = { renderInChat, renderPanel, loadDecks };

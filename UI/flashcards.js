// Orbit flashcards: renders decks from the "flashcards" SSE event and runs an
// Anki-style SRS study session. All *scheduling* logic is imported from the
// backend's /srs.js (proxied by server.js) so it stays single-source with
// math-sync — this file is DOM only. Zero external URLs (airplane-mode safe).

/** @typedef {{ front: string, back: string, srs?: object }} Flashcard */
/** @typedef {{ title: string, cards: Flashcard[] }} FlashcardDeck */

// Single source of truth for scheduling (tested in math-sync/src/srs.test.ts).
import { newCardState, grade, buildQueue, previewIntervals } from "/srs.js";
// Missed-question → flashcard logic, single-sourced from the backend module
// (tested in math-sync/src/missed.test.ts). Re-exposed on window for the classic
// app.js quiz renderer, which cannot use ES imports itself.
import { qualifies, buildCard, addMissedCard } from "/missed.js";

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

/** Anki plain-text import: front<TAB>back per line (tabs/newlines → spaces). */
function toAnkiTsv(cards) {
  const clean = (s) => s.replace(/[\t\n\r]+/g, " ").trim();
  return cards.map((c) => `${clean(c.front)}\t${clean(c.back)}`).join("\n");
}

// --- saved decks (localStorage; local machine only, "nothing leaves") --------
// Same store key as math-sync so missed-quiz cards (added via quiz grading) and
// tutor decks land in one place.
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

function persistDecks(decks) {
  localStorage.setItem(STORE_KEY, JSON.stringify(decks));
}

/** Cards a study session would show right now (due learning/review + new). */
function dueCount(deck, now) {
  return buildQueue(deck.cards, now, 20).length;
}

/** Scale type to content length, matching math-sync's study typography. */
function sizeClassFor(text) {
  if (text.length > 220) return "study-long";
  if (text.length > 90) return "study-med";
  return "study-big";
}

/** Build the inline flip-deck used under a chat bubble and in the decks list. */
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
  prev.className = "btn btn-ghost";
  prev.textContent = "← Prev";
  const next = document.createElement("button");
  next.type = "button";
  next.className = "btn btn-ghost";
  next.textContent = "Next →";
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn btn-ghost fc-export";
  exportBtn.textContent = "⬇ Export for Anki";
  nav.append(prev, next, exportBtn);

  const foot = document.createElement("p");
  foot.className = "muted fc-foot";
  foot.textContent =
    "Cards by Gemma from your course · export imports directly into Anki (File → Import, tab-separated).";

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

/** Chat entry point: render inline under the assistant bubble AND save the deck. */
function render(bubble, deck) {
  const box = buildDeck(deck);
  if (!box) return;
  saveDeck(deck);
  const cta = document.createElement("button");
  cta.type = "button";
  cta.className = "btn fc-study-cta";
  cta.textContent = "Study this deck (SRS)";
  cta.addEventListener("click", () => openStudyOverlay(deck.title));
  box.appendChild(cta);
  bubble.appendChild(box);
}

// --- SRS study session (Anki-style) ------------------------------------------
// Renders into a full-screen overlay so it works from the chat drawer. The
// scheduler (grade/buildQueue/previewIntervals) is imported from /srs.js;
// this only drives the DOM and persists after each grade.

function renderMathInEl(el) {
  if (window.renderMathInElement) {
    window.renderMathInElement(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
    });
  }
}

/** Open the decks list / study overlay. `focusTitle` opens straight into study. */
function openStudyOverlay(focusTitle) {
  const overlay = document.getElementById("fcOverlay");
  const body = document.getElementById("fcOverlayBody");
  if (!overlay || !body) return;
  overlay.classList.remove("hidden");
  renderDeckList(body, focusTitle);
}

function closeStudyOverlay() {
  const overlay = document.getElementById("fcOverlay");
  if (overlay) overlay.classList.add("hidden");
}

/** Deck list inside the overlay; open/study/export/delete per deck. */
function renderDeckList(body, focusTitle) {
  const decks = loadDecks();
  body.textContent = "";

  if (decks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = 'No decks yet — ask Gemma: "create flashcards for the first lesson".';
    body.appendChild(empty);
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
    const strong = document.createElement("strong");
    strong.textContent = deck.title;
    const sub = document.createElement("span");
    sub.className = "muted";
    sub.textContent = ` · ${deck.cards.length} cards${when ? ` · ${when}` : ""}`;
    label.append(strong, sub);

    const study = document.createElement("button");
    study.type = "button";
    study.className = "btn fc-row-study";
    const due = dueCount(deck, Date.now());
    study.textContent = due > 0 ? `Study (${due})` : "Study";
    study.disabled = due === 0;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-ghost fc-row-del";
    del.textContent = "✕";
    del.setAttribute("aria-label", `Delete deck ${deck.title}`);

    head.append(label, study, del);
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
    study.addEventListener("click", () => startStudy(body, decks, index));
    del.addEventListener("click", () => {
      deleteDeck(index);
      renderDeckList(body);
    });
    body.appendChild(row);

    if (focusTitle && deck.title === focusTitle && due > 0) {
      startStudy(body, decks, index);
    }
  });
}

/** Run the SRS study session for one deck, taking over the overlay body. */
function startStudy(body, decks, deckIndex) {
  const deck = decks[deckIndex];
  const queue = buildQueue(deck.cards, Date.now(), 20);

  body.textContent = "";
  const stage = document.createElement("div");
  stage.className = "study-stage";
  body.appendChild(stage);

  function exit() {
    renderDeckList(body); // due counts changed
  }

  const bar = document.createElement("div");
  bar.className = "study-bar";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "btn btn-ghost study-back";
  back.textContent = "← Decks";
  back.addEventListener("click", exit);
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
  showBtn.className = "btn study-show";
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
    renderMathInEl(face);
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
    renderMathInEl(face);
    showBtn.hidden = true;
    grades.hidden = false;
    grades.textContent = "";
    const previews = previewIntervals(card.srs, Date.now());
    for (const rating of ["again", "hard", "good", "easy"]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `btn study-grade study-${rating}`;
      const strong = document.createElement("strong");
      strong.textContent = `${rating[0].toUpperCase()}${rating.slice(1)}`;
      const span = document.createElement("span");
      span.className = "muted";
      span.textContent = previews[rating];
      b.append(strong, document.createElement("br"), span);
      b.addEventListener("click", () => {
        const nowMs = Date.now();
        card.srs = grade(card.srs ?? newCardState(nowMs), rating, nowMs);
        persistDecks(decks); // persist scheduling after every grade
        reviewed++;
        // "Again"/"Hard" in learning re-queue the card at the end of this session.
        if (card.srs.phase === "learning" && (rating === "again" || rating === "hard")) queue.push(card);
        i++;
        showCard();
      });
      grades.appendChild(b);
    }
  });

  showCard();
}

// Expose loadDecks/persistDecks so the quiz module can add missed-question cards
// into the SAME store through these canonical helpers (matches math-sync).
window.orbitFlashcards = { render, openStudyOverlay, closeStudyOverlay, loadDecks, persistDecks };
// Alias under the math-sync name so the store is shared with any msFlashcards code.
window.msFlashcards = { loadDecks, persistDecks };

// Missed-question loop: app.js (classic script) calls this after grading a quiz.
// If the student needed 3+ attempts, the revealed answer becomes a new SRS card
// in the shared "Missed questions" deck (deduped). Pure decision in /missed.js.
window.orbitMissed = {
  /** @returns {boolean} true if a card was actually added (for a UI note). */
  maybeAdd(question, result) {
    if (!qualifies(result)) return false;
    const card = buildCard(question, result.expected);
    const { decks, added } = addMissedCard(loadDecks(), card);
    if (!added) return false;
    persistDecks(decks);
    return true;
  },
};

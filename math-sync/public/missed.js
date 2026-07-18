// feat/missed: turn missed quiz questions into an SRS flashcard deck (the loop-closer).
// Pure, DOM-free logic — shared by quiz.js (browser) and src/missed.test.ts (bun).
// No imports, no localStorage here: the caller owns the store; this module only
// decides *whether* a missed problem becomes a card and *how* it lands in a decks array.

/** Title of the auto-generated deck; find-or-created by this exact string. */
export const MISSED_DECK_TITLE = "Missed questions";

/** The server reveals `expected` only on a pass or the 3rd failed attempt. */
const REVEAL_AFTER_ATTEMPTS = 3;

function normalizeFront(front) {
  return typeof front === "string" ? front.trim() : "";
}

/**
 * Should this graded attempt become a "Missed questions" card?
 * True when the student needed 3+ attempts — i.e. the 3rd-fail reveal, or a pass
 * that only landed after 2+ failures. Requires the revealed expected answer to
 * be present (it isn't until the reveal), so we always have a card back to store.
 * @param {{ pass?: boolean, attempts?: number, expected?: string }} result
 */
export function qualifies(result) {
  if (!result || typeof result.attempts !== "number") return false;
  if (typeof result.expected !== "string" || result.expected.trim() === "") return false;
  return result.attempts >= REVEAL_AFTER_ATTEMPTS;
}

/**
 * Build a fresh flashcard from a missed problem. No `srs` state → the scheduler
 * treats it as new and surfaces it in the next study session automatically.
 */
export function buildCard(question, expected) {
  return { front: String(question ?? "").trim(), back: String(expected ?? "").trim() };
}

/**
 * Add `card` to the "Missed questions" deck within a decks array (find-or-create),
 * deduped by front text, newest-first, deck floated to the front. Pure: never
 * mutates the input; returns a new array only when something actually changed.
 * @returns {{ decks: Array, added: boolean }}
 */
export function addMissedCard(decks, card, maxDecks = 20) {
  const list = Array.isArray(decks) ? decks : [];
  const front = normalizeFront(card && card.front);
  if (front === "") return { decks: list, added: false };

  let missed = null;
  const others = [];
  for (const d of list) {
    if (missed === null && d && d.title === MISSED_DECK_TITLE) missed = d;
    else others.push(d);
  }

  const existing = missed && Array.isArray(missed.cards) ? missed.cards : [];
  if (existing.some((c) => normalizeFront(c && c.front) === front)) {
    return { decks: list, added: false };
  }

  const nextMissed = { ...(missed ?? {}), title: MISSED_DECK_TITLE, cards: [card, ...existing] };
  return { decks: [nextMissed, ...others].slice(0, maxDecks), added: true };
}

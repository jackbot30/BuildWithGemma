/**
 * Flashcards (feat/flashcards): Gemma composes front/back cards from the loaded
 * course via the create_flashcards tool; the client renders a flip-deck in chat
 * and can export Anki-importable TSV (front<TAB>back per line). Stateless — the
 * full deck travels in the AgentEvent (nothing to grade, so no server store).
 */

export interface Flashcard {
  front: string;
  back: string;
}

export interface FlashcardDeck {
  title: string;
  cards: Flashcard[];
}

const MAX_CARDS = 30;

export function validateCards(raw: Array<{ front: unknown; back: unknown }>): {
  accepted: Flashcard[];
  rejected: Array<{ index: number; reason: string }>;
} {
  const accepted: Flashcard[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  raw.forEach((c, index) => {
    const front = typeof c.front === "string" ? c.front.trim() : "";
    const back = typeof c.back === "string" ? c.back.trim() : "";
    if (!front) return rejected.push({ index, reason: "front is empty or not a string" });
    if (!back) return rejected.push({ index, reason: "back is empty or not a string" });
    if (accepted.length >= MAX_CARDS) return rejected.push({ index, reason: `deck capped at ${MAX_CARDS} cards` });
    accepted.push({ front, back });
  });
  return { accepted, rejected };
}

/** Anki's plain-text import format: one card per line, front<TAB>back. */
export function toAnkiTsv(cards: Flashcard[]): string {
  const clean = (s: string) => s.replace(/[\t\n\r]+/g, " ").trim();
  return cards.map((c) => `${clean(c.front)}\t${clean(c.back)}`).join("\n");
}

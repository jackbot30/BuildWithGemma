/**
 * Composer-intent detection for chat turns (feat/flashcards + feat/quiz).
 *
 * When the student asks for flashcards or a quiz, server.ts appends a per-turn
 * instruction AND the agent loop enforces the composer tool (one firm extra round)
 * — small Gemma otherwise sometimes writes the content in prose. Precision matters
 * ("report card", "test statistic" must NOT trigger); recall matters for the
 * phrasings students actually use ("test me", "drill me", "make me cards").
 */

export type ComposerIntent = "create_flashcards" | "create_quiz" | undefined;

const FLASHCARDS = [
  /flash\s*cards?/i,
  /\banki\b/i,
  // "cards" counts only with a making/studying verb nearby (avoids "report card").
  /\b(make|create|generate|give|get|export|build|study(?:ing)?)\b[^.?!]{0,40}\bcards\b/i,
  /\bstudy cards\b/i,
];

const QUIZ = [
  /\bquiz(?:zes)?\b/i,
  // "test me / drill me" — the verb directed at the tutor, not "test" as a noun.
  /\b(test|drill)\s+me\b/i,
  /\bpractice (problems|questions|set)\b/i,
];

export function detectComposerIntent(message: string): ComposerIntent {
  if (FLASHCARDS.some((re) => re.test(message))) return "create_flashcards";
  if (QUIZ.some((re) => re.test(message))) return "create_quiz";
  return undefined;
}

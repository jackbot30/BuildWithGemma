// Anki-style SM-2 scheduler (feat/srs). Pure functions, NO DOM — this module is
// shared by the browser (flashcards.js study mode) and bun tests (src/srs.test.ts).
//
// Model (compact Anki defaults):
//  - Learning steps 1m → 10m; "good" advances, graduating to a 1-day review;
//    "easy" graduates immediately at 4 days; "again" back to step 0; "hard" repeats.
//  - Reviews: ease factor starts 2.5. again = lapse (ease -0.2, floor 1.3, relearn);
//    hard = interval ×1.2, ease -0.15; good = interval × ease; easy = interval ×
//    ease ×1.3, ease +0.15. Intervals in whole days, minimum 1.

export const LEARNING_STEPS_MS = [60_000, 600_000]; // 1m, 10m
const DAY = 86_400_000;
const GRADUATE_DAYS = 1;
const EASY_GRADUATE_DAYS = 4;
const MIN_EF = 1.3;

/** @typedef {"again"|"hard"|"good"|"easy"} Rating */
/** @typedef {{ phase:"learning"|"review", step:number, ef:number, intervalDays:number, lapses:number, reps:number, due:number }} SrsState */

/** @returns {SrsState} */
export function newCardState(now) {
  return { phase: "learning", step: 0, ef: 2.5, intervalDays: 0, lapses: 0, reps: 0, due: now };
}

/** @param {SrsState} s @param {Rating} rating @param {number} now @returns {SrsState} */
export function grade(s, rating, now) {
  const next = { ...s, reps: s.reps + 1 };
  if (s.phase === "learning") {
    if (rating === "again") {
      next.step = 0;
      next.due = now + LEARNING_STEPS_MS[0];
    } else if (rating === "hard") {
      next.step = s.step;
      next.due = now + LEARNING_STEPS_MS[Math.min(s.step, LEARNING_STEPS_MS.length - 1)];
    } else if (rating === "easy") {
      next.phase = "review";
      next.intervalDays = EASY_GRADUATE_DAYS;
      next.due = now + EASY_GRADUATE_DAYS * DAY;
    } else {
      // good
      const stepAfter = s.step + 1;
      if (stepAfter < LEARNING_STEPS_MS.length) {
        next.step = stepAfter;
        next.due = now + LEARNING_STEPS_MS[stepAfter];
      } else {
        next.phase = "review";
        next.intervalDays = GRADUATE_DAYS;
        next.due = now + GRADUATE_DAYS * DAY;
      }
    }
    return next;
  }
  // review phase
  if (rating === "again") {
    next.phase = "learning";
    next.step = 0;
    next.lapses = s.lapses + 1;
    next.ef = Math.max(MIN_EF, round2(s.ef - 0.2));
    next.intervalDays = 0;
    next.due = now + LEARNING_STEPS_MS[0];
    return next;
  }
  let interval;
  if (rating === "hard") {
    interval = Math.max(1, Math.round(s.intervalDays * 1.2));
    next.ef = Math.max(MIN_EF, round2(s.ef - 0.15));
  } else if (rating === "easy") {
    interval = Math.max(1, Math.round(s.intervalDays * s.ef * 1.3));
    next.ef = round2(s.ef + 0.15);
  } else {
    interval = Math.max(1, Math.round(s.intervalDays * s.ef));
  }
  next.intervalDays = interval;
  next.due = now + interval * DAY;
  return next;
}

/**
 * Study queue: due learning cards first (most urgent), then due reviews, then
 * up to `newCap` brand-new cards. Cards not due stay out.
 * @param {Array<{srs?: SrsState}>} cards
 */
export function buildQueue(cards, now, newCap = 20) {
  const learning = [];
  const reviews = [];
  const fresh = [];
  for (const c of cards) {
    if (!c.srs) fresh.push(c);
    else if (c.srs.due <= now) (c.srs.phase === "learning" ? learning : reviews).push(c);
  }
  learning.sort((a, b) => a.srs.due - b.srs.due);
  reviews.sort((a, b) => a.srs.due - b.srs.due);
  return [...learning, ...reviews, ...fresh.slice(0, newCap)];
}

/** Human label for what each rating would schedule — shown on the grade buttons. */
export function previewIntervals(s, now) {
  const fmt = (state) => {
    const ms = state.due - now;
    if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))}m`;
    if (ms < DAY * 1.5) return "1d";
    return `${Math.round(ms / DAY)}d`;
  };
  const base = s ?? newCardState(now);
  return {
    again: fmt(grade(base, "again", now)),
    hard: fmt(grade(base, "hard", now)),
    good: fmt(grade(base, "good", now)),
    easy: fmt(grade(base, "easy", now)),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

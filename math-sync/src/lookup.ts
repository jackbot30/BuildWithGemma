/**
 * Lesson lookup / scoring for the lookup_course tool.
 *
 * S3 improvements over the original course.ts binary-presence scorer:
 *  1. Lesson id and title are included in the scored text at a 5x boost.
 *  2. Term frequency (count of occurrences, not just presence).
 *  3. Normalized by section length so long lessons don't win by bulk.
 *  4. Token filter: keep tokens of length ≥1 when numeric, ≥2 otherwise.
 *     "N.N" patterns like "1.1"/"10.3" are kept as single tokens AND mapped
 *     to dash form ("1-1"/"10-3") for matching lesson ids.
 *  5. Numeric tokens only get id/title boost when they come from an explicit
 *     "N.N" lesson-reference pattern; bare digits from math expressions like
 *     "x^2 = 1" score only against the body, not the id/title.
 */

import type { Lesson } from "./course.ts";

export interface ScoredLesson {
  id: string;
  title: string;
  content: string;
  score: number;
}

/** Convert "1.1" → "1-1", "10.3" → "10-3" for matching against lesson ids. */
function dotToDash(s: string): string {
  return s.replace(/\./g, "-");
}

/**
 * Count non-overlapping occurrences of `needle` in `haystack`.
 * Both are expected to be lowercase already.
 */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

/**
 * Count word-boundary occurrences of `token` in `text`.
 * Used for title matching so "1" doesn't match inside "1.2" or "midpoint".
 */
function countWordOccurrences(text: string, token: string): number {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "g");
  return (text.match(re) ?? []).length;
}

/**
 * Count how many times `token` appears as a hyphen-delimited segment in `id`.
 *
 * Tokens with dashes (e.g. "1-1" from "1.1") are matched as consecutive
 * segment runs. Plain tokens are matched as exact individual segments.
 */
function idSegmentHits(id: string, token: string): number {
  const segments = id.split("-");
  if (token.includes("-")) {
    const tokSegs = token.split("-");
    let hits = 0;
    for (let i = 0; i <= segments.length - tokSegs.length; i++) {
      if (tokSegs.every((ts, j) => segments[i + j] === ts)) hits++;
    }
    return hits;
  }
  return segments.filter((seg) => seg === token).length;
}

/**
 * Structured token result from `tokenize`.
 *
 * `idRef` tokens come from explicit "N.N" lesson-reference patterns and are
 *  eligible for the full id+title+body boost.
 * `body` tokens are everything else and score only against the body text.
 */
export interface TokenSet {
  /** Tokens eligible for id+title (5x) and body scoring. */
  idRef: string[];
  /** Tokens that score body only (bare numbers from math expressions, etc.). */
  body: string[];
}

/**
 * Tokenize a query string into structured token sets.
 *
 * Rules:
 *  - "N.N…" patterns (e.g. "1.1", "10.3", "10.11") are emitted as idRef tokens
 *    in their original form and in dash form ("1-1", "10-3").
 *  - All other tokens go into the body bucket.
 *    - Alphabetic/mixed tokens: length ≥ 2 to avoid single-letter noise.
 *    - Pure numeric tokens: length ≥ 1 (kept so bare numbers still score body).
 */
export function tokenize(query: string): TokenSet {
  const raw = query.toLowerCase();
  const idRef: string[] = [];
  const body: string[] = [];

  // Step 1: extract "N.N" lesson-reference patterns as idRef tokens.
  const dotPattern = /\b(\d+\.\d+(?:\.\d+)*)\b/g;
  let m: RegExpExecArray | null;
  const coveredRanges: Array<[number, number]> = [];

  while ((m = dotPattern.exec(raw)) !== null) {
    const tok = m[1] ?? m[0];
    idRef.push(tok);             // e.g. "1.1"
    idRef.push(dotToDash(tok)); // e.g. "1-1"
    coveredRanges.push([m.index, m.index + tok.length]);
  }

  // Step 2: tokenize the rest into body tokens.
  const wordPattern = /[a-z0-9]+/g;
  while ((m = wordPattern.exec(raw)) !== null) {
    const tok = m[0];
    const start = m.index;
    const end = start + tok.length;

    // Skip positions already captured by a dot pattern (including the dot itself).
    const alreadyCovered = coveredRanges.some(([cs, ce]) => start >= cs && end <= ce + 1);
    if (alreadyCovered) continue;

    if (/^\d+$/.test(tok)) {
      // Bare numeric — body only (may be a math exponent or literal, not a lesson ref)
      body.push(tok);
    } else if (tok.length >= 2) {
      body.push(tok);
    }
    // single non-numeric chars dropped (too noisy)
  }

  return {
    idRef: [...new Set(idRef)],
    body: [...new Set(body)],
  };
}

/**
 * Score all lessons against a query and return the ones with score > 0,
 * sorted descending by score.
 *
 * idRef tokens (from explicit "N.N" patterns) get 5x weight on id and title.
 * body tokens get 1x weight on body only, normalized by word count.
 * Alphabetic body tokens also score title and id at full 5x.
 */
export function scoreLessons(lessons: Lesson[], query: string): ScoredLesson[] {
  const { idRef, body } = tokenize(query);
  if (idRef.length === 0 && body.length === 0) return [];

  // Alphabetic/mixed tokens in body also get id+title boost.
  // Pure numeric body tokens (bare digits) only score the body.
  const alphaBody = body.filter((t) => !/^\d+$/.test(t));
  const numericBody = body.filter((t) => /^\d+$/.test(t));

  return lessons
    .map((lesson) => {
      const idStr = lesson.id.toLowerCase();
      const titleStr = lesson.title.toLowerCase();
      const bodyStr = lesson.content.toLowerCase();

      // Word count for length normalization
      const wordCount = Math.max(bodyStr.split(/\s+/).length, 1);

      let idScore = 0;
      let titleScore = 0;
      let bodyScore = 0;

      // idRef tokens: full id+title+body boost
      for (const tok of idRef) {
        idScore += idSegmentHits(idStr, tok) * 5;
        titleScore += countWordOccurrences(titleStr, tok) * 5;
        bodyScore += countOccurrences(bodyStr, tok);
      }

      // Alphabetic body tokens: full id+title+body boost (they're real words)
      for (const tok of alphaBody) {
        idScore += idSegmentHits(idStr, tok) * 5;
        titleScore += countWordOccurrences(titleStr, tok) * 5;
        bodyScore += countOccurrences(bodyStr, tok);
      }

      // Numeric body tokens: body only, word-boundary matched so "2" doesn't
      // match inside "x2", "y2", "(x2-x1)" etc.
      for (const tok of numericBody) {
        bodyScore += countWordOccurrences(bodyStr, tok);
      }

      const normalizedScore = idScore + titleScore + bodyScore / wordCount;

      return { ...lesson, score: normalizedScore };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

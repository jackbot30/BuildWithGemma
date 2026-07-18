/**
 * feat/quiz — in-memory quiz store + problem validation + deterministic grading.
 *
 * Gemma COMPOSES quizzes (questions + answer key), but grading NEVER trusts the
 * model: every student answer is verified against the stored key by the existing
 * deterministic checker (src/checker.ts — 5-random-point symbolic equality).
 * Isolated on purpose: nothing here imports agent/server code.
 */

import { create, all, type FactoryFunctionMap, type MathNode } from "mathjs";
import { checkAnswer, checkSet } from "./checker.ts";

const math = create(all as FactoryFunctionMap, {});

export type ProblemType = "numeric" | "expression";

export interface QuizProblem {
  question: string;
  /** Answer key — server-side only; NEVER sent to the client. */
  expected: string;
  type: ProblemType;
}

export interface Quiz {
  id: number;
  title: string;
  problems: QuizProblem[];
  /** Failed+passed grade calls per problem (attempt tracking for reveal-after-3). */
  attempts: number[];
  /** Problems already answered correctly. */
  solved: boolean[];
}

/** What the client is allowed to see — no expected answers in the DOM. */
export interface QuizClientView {
  id: number;
  title: string;
  problems: Array<{ question: string; type: ProblemType }>;
}

export interface ValidationResult {
  accepted: QuizProblem[];
  rejected: Array<{ index: number; reason: string }>;
}

/**
 * Split a multi-value expected/answer ("x=2 or x=3", "-1, 2") into bare
 * expressions. Splitting only — all equality checking stays in checker.ts.
 */
function splitParts(s: string): string[] {
  return s
    .split(/\bor\b|\band\b|,|;/i)
    .map((p) => p.replace(/^\s*[a-zA-Z]\w*\s*=\s*/, "").trim())
    .filter(Boolean);
}

/** Why a single expected part is invalid for its type, or null if fine. */
function partProblem(part: string, type: ProblemType): string | null {
  let node: MathNode;
  try {
    node = math.parse(part.replace(/\*\*/g, "^"));
  } catch (e) {
    return `"${part}" does not parse: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (type === "expression") return null;
  // numeric: must evaluate to a finite real with no free variables.
  try {
    const v: unknown = node.compile().evaluate({});
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return `"${part}" is not a finite numeric value (type is "numeric")`;
    }
  } catch (e) {
    return `"${part}" does not evaluate as numeric: ${e instanceof Error ? e.message : String(e)}`;
  }
  return null;
}

/**
 * Infer a gradeable type from an expected value: "numeric" if every part
 * evaluates to a finite real, "expression" if every part at least parses,
 * null if ungradeable. Fallback for small-Gemma made-up type labels
 * ("multiple choice", "algebraic") when the value itself is fine.
 */
export function inferType(expected: string): ProblemType | null {
  const parts = splitParts(expected);
  if (parts.length === 0) return null;
  if (parts.every((p) => partProblem(p, "numeric") === null)) return "numeric";
  if (parts.every((p) => partProblem(p, "expression") === null)) return "expression";
  return null;
}

/** Validate model-supplied problems. Shape AND math are checked — never trust the model. */
export function validateProblems(problems: readonly unknown[]): ValidationResult {
  const accepted: QuizProblem[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  problems.forEach((raw, index) => {
    if (typeof raw !== "object" || raw === null) {
      rejected.push({ index, reason: "problem must be an object with question, expected, type" });
      return;
    }
    const p = raw as Record<string, unknown>;
    const question = typeof p.question === "string" ? p.question.trim() : "";
    const expected = typeof p.expected === "string" ? p.expected.trim() : "";
    const type = p.type;
    if (!question) {
      rejected.push({ index, reason: "question must be a non-empty string" });
      return;
    }
    if (!expected) {
      rejected.push({ index, reason: "expected must be a non-empty string" });
      return;
    }
    if (type !== "numeric" && type !== "expression") {
      rejected.push({ index, reason: `type must be "numeric" or "expression", got ${JSON.stringify(type)}` });
      return;
    }
    const parts = splitParts(expected);
    if (parts.length === 0) {
      rejected.push({ index, reason: "expected contains no expression" });
      return;
    }
    const bad = parts.map((part) => partProblem(part, type)).find((r) => r !== null);
    if (bad) {
      rejected.push({ index, reason: bad });
      return;
    }
    accepted.push({ question, expected, type });
  });
  return { accepted, rejected };
}

// ── store: last MAX_QUIZZES quizzes in memory ───────────────────────────────

export const MAX_QUIZZES = 20;
const quizzes = new Map<number, Quiz>();
let nextId = 1;

export function createQuiz(title: string, problems: QuizProblem[]): Quiz {
  const quiz: Quiz = {
    id: nextId++,
    title,
    problems: [...problems],
    attempts: problems.map(() => 0),
    solved: problems.map(() => false),
  };
  quizzes.set(quiz.id, quiz);
  // Map iterates in insertion order — evict the oldest beyond the cap.
  while (quizzes.size > MAX_QUIZZES) {
    const oldest = quizzes.keys().next().value;
    if (oldest === undefined) break;
    quizzes.delete(oldest);
  }
  return quiz;
}

export function getQuiz(id: number): Quiz | undefined {
  return quizzes.get(id);
}

export function toClientView(quiz: Quiz): QuizClientView {
  return {
    id: quiz.id,
    title: quiz.title,
    problems: quiz.problems.map((p) => ({ question: p.question, type: p.type })),
  };
}

// ── grading ─────────────────────────────────────────────────────────────────

const REVEAL_AFTER_ATTEMPTS = 3;

export type GradeResult =
  | {
      status: "ok";
      pass: boolean;
      /** Attempts on this problem so far, including this one. */
      attempts: number;
      /** mathjs-normalized display of the student's answer (falls back to trimmed input). */
      normalized: string;
      /** The answer key — ONLY present after a correct answer or the 3rd failed attempt. */
      expected?: string;
    }
  | { status: "quiz-not-found" }
  | { status: "bad-index" };

/** Pretty-print the student's answer via mathjs; multi-part answers part-by-part. */
function normalizeAnswer(answer: string): string {
  const parts = splitParts(answer);
  if (parts.length === 0) return answer.trim();
  try {
    return parts.map((p) => math.parse(p.replace(/\*\*/g, "^")).toString()).join(", ");
  } catch {
    return answer.trim();
  }
}

/**
 * Grade one student answer against the stored key using the EXISTING
 * deterministic checker (checkAnswer / checkSet) — never the model.
 */
export function gradeAnswer(quizId: number, index: number, answer: string): GradeResult {
  const quiz = quizzes.get(quizId);
  if (!quiz) return { status: "quiz-not-found" };
  if (!Number.isInteger(index) || index < 0 || index >= quiz.problems.length) {
    return { status: "bad-index" };
  }
  const problem = quiz.problems[index];
  if (!problem) return { status: "bad-index" };

  const got = splitParts(answer);
  const exp = splitParts(problem.expected);
  const multi = got.length > 1 || exp.length > 1;
  const pass = multi
    ? checkSet(got, exp)
    : checkAnswer(got[0] ?? answer, exp[0] ?? problem.expected).equal;

  const attempts = (quiz.attempts[index] ?? 0) + 1;
  quiz.attempts[index] = attempts;
  if (pass) quiz.solved[index] = true;

  const reveal = pass || quiz.solved[index] === true || attempts >= REVEAL_AFTER_ATTEMPTS;
  const result: GradeResult = { status: "ok", pass, attempts, normalized: normalizeAnswer(answer) };
  if (reveal) result.expected = problem.expected;
  return result;
}

/** Test helper — reset the store. */
export function clearQuizzes(): void {
  quizzes.clear();
  nextId = 1;
}

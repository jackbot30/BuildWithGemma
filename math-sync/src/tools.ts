/**
 * Gemma's function-calling tools. Each tool = a JSON-Schema definition (sent to
 * Ollama) + a validated `run`. Args are validated before dispatch — never trust
 * the model's arg types (no `any`).
 */

import type { ToolSchema } from "./ollama.ts";
import type { CoursePack } from "./course.ts";
import { lookupCourse } from "./course.ts";
import { checkAnswer, checkSet } from "./checker.ts";
import { calculateExpression } from "./calc.ts";
import { validateProblems, createQuiz, toClientView, inferType, type QuizClientView } from "./quiz.ts"; // feat/quiz
import { verifySolution } from "./verify.ts";
import { validateCards, type FlashcardDeck } from "./flashcards.ts"; // feat/flashcards

/** Split a free-form answer ("x=2 or x=3", "2, -2") into bare expressions. */
function splitAnswers(s: string): string[] {
  return s
    .split(/\bor\b|\band\b|,|;/i)
    .map((p) => p.replace(/^\s*[a-zA-Z]\w*\s*=\s*/, "").trim())
    .filter(Boolean);
}

export interface PlotSpec {
  fn: string;
  domain: [number, number];
}

export interface ToolContext {
  course: CoursePack;
  /** Client-render side effects the loop collects (graphs, badges) for the UI. */
  plots: PlotSpec[];
  /** feat/quiz: quizzes created this round — agent loop emits them to the client (no answers).
   * Optional so contexts that never render (eval CLI) don't need it. */
  quizzes?: QuizClientView[];
  /** feat/flashcards: decks created this round — emitted whole (nothing to grade). */
  flashcards?: FlashcardDeck[];
}

interface Tool {
  schema: ToolSchema;
  run: (args: Record<string, unknown>, ctx: ToolContext) => string;
}

const asString = (v: unknown, field: string): string => {
  if (typeof v !== "string") throw new Error(`${field} must be a string`);
  return v;
};

const asNumber = (v: unknown, field: string): number => {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`${field} must be a number`);
  return n;
};

const TOOLS: Record<string, Tool> = {
  lookup_course: {
    schema: {
      type: "function",
      function: {
        name: "lookup_course",
        description:
          "Search the loaded course (syllabus + lessons) for relevant material. Use this to ground every answer in the student's actual course before explaining.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Topic or keyword, e.g. 'quadratic formula'" },
          },
          required: ["query"],
        },
      },
    },
    run: (args, ctx) => lookupCourse(ctx.course, asString(args.query, "query")),
  },

  verify_solution: {
    schema: {
      type: "function",
      function: {
        name: "verify_solution",
        description:
          "Verify proposed equation solution(s) by substituting them back into the original equation and comparing LHS vs RHS numerically. Truly independent — no answer key needed. Use this after solving any equation, before stating solutions to the student.",
        parameters: {
          type: "object",
          properties: {
            equation: {
              type: "string",
              description: "The original equation, e.g. 'x^2 - 5x + 6 = 0' or '2y + 1 = 7'. If no '=' present, RHS is assumed 0.",
            },
            proposed: {
              type: "string",
              description: "The solution(s) to verify, e.g. '2, 3', 'x = 2 and x = 3', '±1', 'y = 3'",
            },
          },
          required: ["equation", "proposed"],
        },
      },
    },
    run: (args) => {
      const equation = asString(args.equation, "equation");
      const proposed = asString(args.proposed, "proposed");
      const result = verifySolution(equation, proposed);
      if (result.ok) {
        const parts = result.verdicts.map((v) => {
          // Find the variable name from the equation for display
          const varMatch = equation.match(/[a-zA-Z]/);
          const varName = varMatch ? varMatch[0] : "x";
          return `${varName}=${v.value}: lhs ${v.lhs} = rhs ${v.rhs} ✓`;
        });
        return `VERIFIED — ${parts.join("; ")}`;
      }
      if (result.verdicts && result.verdicts.length > 0) {
        const varMatch = equation.match(/[a-zA-Z]/);
        const varName = varMatch ? varMatch[0] : "x";
        const parts = result.verdicts.map((v) =>
          v.ok
            ? `${varName}=${v.value}: lhs ${v.lhs} = rhs ${v.rhs} ✓`
            : `${varName}=${v.value}: lhs ${v.lhs} ≠ rhs ${v.rhs}`,
        );
        return `NOT VERIFIED — ${parts.join("; ")}`;
      }
      return `NOT VERIFIED — ${result.reason ?? "solution did not satisfy the equation"}`;
    },
  },

  check_answer: {
    schema: {
      type: "function",
      function: {
        name: "check_answer",
        description:
          "Deterministically verify whether a proposed answer equals the expected answer from the course material. Returns CORRECT or INCORRECT.",
        parameters: {
          type: "object",
          properties: {
            answer: { type: "string", description: "The proposed answer, e.g. 'x = 5' or '3x+2'" },
            expected: {
              type: "string",
              description:
                "The answer-key value from the course material (via lookup_course) or the quiz/eval key. NEVER your own computed answer — checking your answer against itself proves nothing.",
            },
          },
          required: ["answer", "expected"],
        },
      },
    },
    run: (args) => {
      const got = splitAnswers(asString(args.answer, "answer"));
      const exp = splitAnswers(asString(args.expected, "expected"));
      const multi = got.length > 1 || exp.length > 1;
      const equal = multi ? checkSet(got, exp) : checkAnswer(got[0] ?? "", exp[0] ?? "").equal;
      return equal
        ? "CORRECT — verified against the answer key."
        : "INCORRECT — the proposed answer does not equal the expected answer.";
    },
  },

  calculate: {
    schema: {
      type: "function",
      function: {
        name: "calculate",
        description:
          "Evaluate an arithmetic or scientific expression exactly (e.g. '2^10 - 24', 'sqrt(3^2 + 4^2)', 'sin(pi/6)'). Use this instead of doing arithmetic in your head — it never makes calculation mistakes.",
        parameters: {
          type: "object",
          properties: {
            expression: {
              type: "string",
              description: "The expression to evaluate, e.g. '(-5 + sqrt(25 - 24)) / 2'",
            },
          },
          required: ["expression"],
        },
      },
    },
    run: (args) => {
      const expression = asString(args.expression, "expression");
      const result = calculateExpression(expression);
      return result.startsWith("Error:") ? result : `${expression.trim()} = ${result}`;
    },
  },

  plot: {
    schema: {
      type: "function",
      function: {
        name: "plot",
        description:
          "Graph a function of x over a range. The graph renders on the student's screen. Use it whenever a visual would help (parabolas, lines, etc.).",
        parameters: {
          type: "object",
          properties: {
            fn: { type: "string", description: "Function of x in math notation, e.g. 'x^2 - 5x + 6'" },
            min: { type: "number", description: "Left end of the x-range (default -10)" },
            max: { type: "number", description: "Right end of the x-range (default 10)" },
          },
          required: ["fn"],
        },
      },
    },
    run: (args, ctx) => {
      const fn = asString(args.fn, "fn").replace(/\*\*/g, "^");
      let min = args.min === undefined ? -10 : asNumber(args.min, "min");
      let max = args.max === undefined ? 10 : asNumber(args.max, "max");
      // Sanitize model-supplied domains: inverted → swap; degenerate/non-finite/
      // absurd → default. A blank graph live is worse than a clamped one.
      if (min > max) [min, max] = [max, min];
      if (!Number.isFinite(min) || !Number.isFinite(max) || min === max || max - min > 1e6) {
        [min, max] = [-10, 10];
      }
      ctx.plots.push({ fn, domain: [min, max] });
      return `Graphed ${fn} on [${min}, ${max}] — now visible to the student.`;
    },
  },

  // feat/quiz: Gemma composes the quiz; grading stays deterministic (src/quiz.ts → checker.ts).
  create_quiz: {
    schema: {
      type: "function",
      function: {
        name: "create_quiz",
        description:
          "Create a practice quiz for the student. Provide 3-5 problems; each expected answer must be a short computable value like '3', '-1, 2', or '2x+1' (no units, no prose). The quiz renders on the student's screen and their answers are graded deterministically.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Quiz title, e.g. 'Lesson 1.1 practice'" },
            problems: {
              type: "array",
              description: "The quiz problems with their answer key",
              items: {
                type: "object",
                properties: {
                  question: { type: "string", description: "The question shown to the student" },
                  expected: {
                    type: "string",
                    description: "The correct answer in plain math form, e.g. '3', '-1, 2', '2x+1'",
                  },
                  type: {
                    type: "string",
                    enum: ["numeric", "expression"],
                    description: "'numeric' for a number (or number list), 'expression' for an algebraic expression",
                  },
                },
                required: ["question", "expected", "type"],
              },
            },
          },
          required: ["title", "problems"],
        },
      },
    },
    run: (args, ctx) => {
      const title = asString(args.title, "title").trim() || "Practice quiz";
      if (!Array.isArray(args.problems)) throw new Error("problems must be an array");
      // Small Gemma often invents type labels ("multiple choice", "algebraic").
      // If the expected value itself is gradeable, infer the type instead of failing.
      const normalized = (args.problems as unknown[]).map((raw) => {
        if (typeof raw !== "object" || raw === null) return raw;
        const p = raw as Record<string, unknown>;
        if ((p.type === "numeric" || p.type === "expression") || typeof p.expected !== "string") return raw;
        const inferred = inferType(p.expected);
        return inferred ? { ...p, type: inferred } : raw;
      });
      const { accepted, rejected } = validateProblems(normalized);
      const rejectedNote = rejected
        .map((r) => `problem ${r.index + 1}: ${r.reason}`)
        .join("; ");
      if (accepted.length === 0) {
        return `Error: no valid problems — ${rejectedNote || "problems array is empty"}. Fix the expected answers (short computable values like '3', '-1, 2', '2x+1') and call create_quiz again.`;
      }
      const quiz = createQuiz(title, accepted);
      (ctx.quizzes ??= []).push(toClientView(quiz));
      const dropped = rejected.length
        ? ` Dropped ${rejected.length} invalid problem(s): ${rejectedNote}.`
        : "";
      return `Created quiz #${quiz.id} "${title}" with ${accepted.length} problem(s) — now on the student's screen.${dropped} Tell the student to answer in the quiz card; their answers are checked automatically.`;
    },
  },

  // feat/flashcards: Gemma composes front/back cards; client renders a flip deck
  // + Anki TSV export. Stateless — the whole deck travels in the event.
  create_flashcards: {
    schema: {
      type: "function",
      function: {
        name: "create_flashcards",
        description:
          "Create study flashcards for the student from the course material. Provide 5-15 cards; front = a short prompt/term/question, back = the concise answer/definition/formula. The deck renders on the student's screen with flip navigation and can be exported to Anki.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Deck title, e.g. 'Lesson 1.1 — Coordinate Plane'" },
            cards: {
              type: "array",
              description: "The flashcards",
              items: {
                type: "object",
                properties: {
                  front: { type: "string", description: "Prompt side — term, question, or formula name" },
                  back: { type: "string", description: "Answer side — concise definition, value, or formula" },
                },
                required: ["front", "back"],
              },
            },
          },
          required: ["title", "cards"],
        },
      },
    },
    run: (args, ctx) => {
      const title = asString(args.title, "title").trim() || "Flashcards";
      if (!Array.isArray(args.cards)) throw new Error("cards must be an array");
      const { accepted, rejected } = validateCards(
        (args.cards as unknown[]).map((raw) => {
          const c = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
          return { front: c.front, back: c.back };
        }),
      );
      if (accepted.length === 0) {
        return `Error: no valid cards — every card needs a non-empty front and back. Fix and call create_flashcards again.`;
      }
      (ctx.flashcards ??= []).push({ title, cards: accepted });
      const dropped = rejected.length ? ` Dropped ${rejected.length} invalid card(s).` : "";
      return `Created flashcard deck "${title}" with ${accepted.length} card(s) — now on the student's screen with flip navigation and an Anki export button.${dropped}`;
    },
  },
};

export const toolSchemas: ToolSchema[] = Object.values(TOOLS).map((t) => t.schema);

/** Tools offered to the model in CHAT. check_answer is deliberately excluded: with no
 * course-sourced key in the chat flow, the model can only self-check (circular). Chat's
 * verifier is verify_solution; check_answer remains for eval/run.ts and quiz grading,
 * which call it server-side with a real key. */
export const chatToolSchemas: ToolSchema[] = toolSchemas.filter(
  (s) => s.function.name !== "check_answer",
);

export function dispatchTool(name: string, args: Record<string, unknown>, ctx: ToolContext): string {
  const tool = TOOLS[name];
  if (!tool) return `Error: unknown tool "${name}"`;
  try {
    return tool.run(args ?? {}, ctx);
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

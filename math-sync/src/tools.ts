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

  check_answer: {
    schema: {
      type: "function",
      function: {
        name: "check_answer",
        description:
          "Deterministically verify whether a proposed answer equals the expected answer. Call this on EVERY final numeric or algebraic answer before telling the student. Returns CORRECT or INCORRECT.",
        parameters: {
          type: "object",
          properties: {
            answer: { type: "string", description: "The proposed answer, e.g. 'x = 5' or '3x+2'" },
            expected: { type: "string", description: "The known-correct answer to check against" },
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
      const min = args.min === undefined ? -10 : asNumber(args.min, "min");
      const max = args.max === undefined ? 10 : asNumber(args.max, "max");
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
};

export const toolSchemas: ToolSchema[] = Object.values(TOOLS).map((t) => t.schema);

export function dispatchTool(name: string, args: Record<string, unknown>, ctx: ToolContext): string {
  const tool = TOOLS[name];
  if (!tool) return `Error: unknown tool "${name}"`;
  try {
    return tool.run(args ?? {}, ctx);
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

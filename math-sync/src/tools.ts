/**
 * Gemma's function-calling tools. Each tool = a JSON-Schema definition (sent to
 * Ollama) + a validated `run`. Args are validated before dispatch — never trust
 * the model's arg types (no `any`).
 */

import type { ToolSchema } from "./ollama.ts";
import type { CoursePack } from "./course.ts";
import { lookupCourse } from "./course.ts";
import { checkAnswer, checkSet } from "./checker.ts";

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

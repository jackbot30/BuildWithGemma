// Red-first: the chat loop must not offer check_answer (circular-check hole) —
// verify_solution is chat's only verifier. check_answer stays for eval/quiz (server-side).

import { describe, expect, test } from "bun:test";
import { chatToolSchemas, toolSchemas } from "./tools.ts";

const names = (schemas: typeof toolSchemas) => schemas.map((s) => s.function.name);

describe("chatToolSchemas", () => {
  test("excludes check_answer", () => {
    expect(names(chatToolSchemas)).not.toContain("check_answer");
  });

  test("includes every other tool", () => {
    const n = names(chatToolSchemas);
    for (const required of [
      "lookup_course",
      "verify_solution",
      "calculate",
      "plot",
      "create_quiz",
      "create_flashcards",
    ]) {
      expect(n).toContain(required);
    }
  });

  test("full registry still includes check_answer (eval/quiz use it server-side)", () => {
    expect(names(toolSchemas)).toContain("check_answer");
  });
});

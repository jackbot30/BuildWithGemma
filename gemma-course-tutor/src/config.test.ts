/** Course-pack fallback resolver — pure logic, no Ollama. Run: bun run src/config.test.ts */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveCoursePackDir } from "./config.ts";

let pass = 0;
let fail = 0;
const check = (name: string, got: string, want: string) => {
  const ok = got === want;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${got}, want ${want})`}`);
};

/** Build a throwaway workspace with an (optionally) populated primary pack + a fallback. */
function makeWorkspace(withPrimaryLessons: boolean): {
  root: string;
  primary: string;
  fallback: string;
} {
  const root = mkdtempSync(join(tmpdir(), "gct-config-"));
  const primary = join(root, "course-pack");
  const fallback = join(root, "sample-course");
  // The fallback always has a lessons dir with content (it ships with the repo).
  mkdirSync(join(fallback, "lessons"), { recursive: true });
  writeFileSync(join(fallback, "lessons", "1-1.md"), "# sample\n");
  // The primary either has a usable lessons dir, or (fresh clone) only a README.
  if (withPrimaryLessons) {
    mkdirSync(join(primary, "lessons"), { recursive: true });
    writeFileSync(join(primary, "lessons", "1-1.md"), "# real\n");
  } else {
    mkdirSync(primary, { recursive: true });
    writeFileSync(join(primary, "README.md"), "not included\n");
  }
  return { root, primary, fallback };
}

const workspaces: string[] = [];
const ws = (withPrimaryLessons: boolean) => {
  const w = makeWorkspace(withPrimaryLessons);
  workspaces.push(w.root);
  return w;
};

console.log("— fallback resolver —");

// 1. Fresh clone: primary pack has no lessons → resolve to the bundled sample course.
{
  const { primary, fallback } = ws(false);
  check(
    "empty primary → fallback",
    resolveCoursePackDir({ primaryDir: primary, fallbackDir: fallback }),
    resolve(fallback),
  );
}

// 2. Primary pack has lessons → use it, ignore the fallback.
{
  const { primary, fallback } = ws(true);
  check(
    "populated primary → primary",
    resolveCoursePackDir({ primaryDir: primary, fallbackDir: fallback }),
    resolve(primary),
  );
}

// 3. Explicit override always wins, even when it doesn't exist yet (matches env behaviour).
{
  const { primary, fallback } = ws(false);
  const explicit = join(primary, "..", "my-own-pack");
  check(
    "explicit override → explicit (over fallback)",
    resolveCoursePackDir({ explicit, primaryDir: primary, fallbackDir: fallback }),
    resolve(explicit),
  );
}

// 4. A blank/whitespace explicit value is treated as unset (env vars can be empty strings).
{
  const { primary, fallback } = ws(false);
  check(
    "blank explicit → fallback",
    resolveCoursePackDir({ explicit: "   ", primaryDir: primary, fallbackDir: fallback }),
    resolve(fallback),
  );
}

// 5. Primary dir that doesn't exist at all → fallback (not a crash).
{
  const { fallback } = ws(false);
  check(
    "missing primary dir → fallback",
    resolveCoursePackDir({ primaryDir: join(tmpdir(), "gct-does-not-exist-xyz"), fallbackDir: fallback }),
    resolve(fallback),
  );
}

// 6. Primary has a lessons/ dir but it is EMPTY (no .md) → fallback.
{
  const { primary, fallback } = ws(false);
  mkdirSync(join(primary, "lessons"), { recursive: true }); // empty on purpose
  check(
    "empty lessons dir → fallback",
    resolveCoursePackDir({ primaryDir: primary, fallbackDir: fallback }),
    resolve(fallback),
  );
}

for (const root of workspaces) rmSync(root, { recursive: true, force: true });

console.log(`\n${fail === 0 ? "ALL GREEN" : "HAS FAILURES"}: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);

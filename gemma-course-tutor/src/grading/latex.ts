/**
 * Normalize a LaTeX-ish math answer into a string mathjs can parse.
 * Handles the forms that appear in the course answer keys and model output:
 * \frac, \sqrt, \pi, \cdot, \binom, \log_{b}, ^{...}, implicit multiplication, etc.
 */

/** Read a balanced {...} group starting at s[open] === "{". Returns inner + index after "}". */
function readGroup(s: string, open: number): { inner: string; end: number } {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return { inner: s.slice(open + 1, i), end: i + 1 };
    }
  }
  return { inner: s.slice(open + 1), end: s.length }; // unbalanced — take the rest
}

/** Replace all \cmd{a}{b} (two-arg) using render(a, b), recursing into args. */
function replaceTwoArg(s: string, cmd: string, render: (a: string, b: string) => string): string {
  let out = "";
  let i = 0;
  const token = `\\${cmd}`;
  while (i < s.length) {
    const at = s.indexOf(token, i);
    if (at === -1) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, at);
    let j = at + token.length;
    while (s[j] === " ") j++;
    if (s[j] !== "{") {
      out += token;
      i = at + token.length;
      continue;
    }
    const a = readGroup(s, j);
    let k = a.end;
    while (s[k] === " ") k++;
    if (s[k] !== "{") {
      out += token;
      i = at + token.length;
      continue;
    }
    const b = readGroup(s, k);
    out += render(normalizeLatex(a.inner), normalizeLatex(b.inner));
    i = b.end;
  }
  return out;
}

/** Replace \cmd{a} (one-arg), with optional [n] before the brace (for \sqrt[n]{a}). */
function replaceOneArg(s: string, cmd: string, render: (a: string, opt?: string) => string): string {
  let out = "";
  let i = 0;
  const token = `\\${cmd}`;
  while (i < s.length) {
    const at = s.indexOf(token, i);
    if (at === -1) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, at);
    let j = at + token.length;
    let opt: string | undefined;
    if (s[j] === "[") {
      const close = s.indexOf("]", j);
      if (close !== -1) {
        opt = s.slice(j + 1, close);
        j = close + 1;
      }
    }
    while (s[j] === " ") j++;
    if (s[j] !== "{") {
      out += token;
      i = at + token.length;
      continue;
    }
    const a = readGroup(s, j);
    out += render(normalizeLatex(a.inner), opt);
    i = a.end;
  }
  return out;
}

/** Insert explicit * for implicit multiplication mathjs won't infer: )( , )x, x(, 2( , )2. */
function explicitMultiply(s: string): string {
  return s
    .replace(/\)\s*\(/g, ")*(")
    .replace(/([0-9)])\s*([a-zA-Z(])/g, (m, a: string, b: string) => {
      // don't split a function call like sqrt( or multi-letter names — only insert
      // when the left is a digit/close-paren and right starts a new factor
      if (a === ")" || /[0-9]/.test(a)) return `${a}*${b}`;
      return m;
    });
}

export function normalizeLatex(input: string): string {
  let s = input.trim();

  // strip math delimiters and display wrappers
  s = s.replace(/\$\$?/g, "").replace(/\\displaystyle/g, "");
  s = s.replace(/\\left|\\right/g, "");
  // strip spacing commands
  s = s.replace(/\\[,;!:>]/g, " ").replace(/\\quad|\\qquad/g, " ").replace(/~/g, " ");
  // \text{...} / \mathrm{...} -> drop the wrapper, keep contents
  s = replaceOneArg(s, "text", (a) => a);
  s = replaceOneArg(s, "mathrm", (a) => a);

  // structural commands
  s = replaceTwoArg(s, "frac", (a, b) => `((${a})/(${b}))`);
  s = replaceTwoArg(s, "tfrac", (a, b) => `((${a})/(${b}))`);
  s = replaceTwoArg(s, "dfrac", (a, b) => `((${a})/(${b}))`);
  s = replaceTwoArg(s, "binom", (a, b) => `combinations(${a},${b})`);
  s = replaceOneArg(s, "sqrt", (a, opt) => (opt ? `nthRoot((${a}),${opt})` : `sqrt(${a})`));
  s = replaceOneArg(s, "abs", (a) => `abs(${a})`);

  // \log_{b}(x) -> log(x, b) ; \log_b x handled loosely
  s = s.replace(/\\log_\{([^}]*)\}\s*\(([^)]*)\)/g, (_m, b: string, x: string) => `log(${x}, ${b})`);
  s = s.replace(/\\log_([0-9a-zA-Z])\s*\(([^)]*)\)/g, (_m, b: string, x: string) => `log(${x}, ${b})`);
  s = s.replace(/\\ln/g, "log"); // mathjs log() is natural log
  s = s.replace(/\\log/g, "log10");

  // symbols / operators
  s = s
    .replace(/\\pi/g, "pi")
    .replace(/\\cdot|\\times/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\\pm/g, "±"); // handled by caller via value-splitting, not here

  // superscripts/subscripts: ^{...} -> ^(...) ; drop remaining _{...}
  s = replaceOneArg(s, "^", (a) => `^(${a})`); // rare; usually ^ is a raw char
  s = s.replace(/\^\{([^}]*)\}/g, (_m, a: string) => `^(${a})`);
  s = s.replace(/_\{[^}]*\}/g, "").replace(/_[0-9a-zA-Z]/g, "");

  // strip any leftover backslash-commands we don't model, and stray braces
  s = s.replace(/\\[a-zA-Z]+/g, " ").replace(/[{}]/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  return explicitMultiply(s);
}

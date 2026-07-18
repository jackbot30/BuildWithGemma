/** Chunk lessons by heading. Each chunk keeps its lesson file + heading for citations. */

import { readdir } from "node:fs/promises";
import { join, basename } from "node:path";

export interface Chunk {
  id: string;
  file: string; // lesson filename, e.g. "1-2-distance-and-midpoint.md"
  lessonTitle: string; // the H1
  heading: string; // nearest ## / ### heading ("" for lesson intro)
  text: string;
}

/** Drop online-only image URLs but keep their alt text (it holds spoken-math descriptions). */
function stripImages(md: string): string {
  return md.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt ? `(figure: ${alt})` : ""));
}

const headingLevel = (line: string): number => {
  const m = line.match(/^(#{1,3})\s+/);
  return m ? m[1]!.length : 0;
};

/** Keep chunks under the embed model's context window: pack paragraphs up to maxChars,
 *  hard-splitting any single oversized paragraph. */
const MAX_CHARS = 1500;
function splitLong(text: string, max = MAX_CHARS): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = "";
  for (const para of text.split(/\n\s*\n/)) {
    if (para.length > max) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      for (let i = 0; i < para.length; i += max) out.push(para.slice(i, i + max));
      continue;
    }
    const merged = cur ? `${cur}\n\n${para}` : para;
    if (merged.length > max) {
      if (cur) out.push(cur);
      cur = para;
    } else {
      cur = merged;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function chunkLesson(file: string, md: string): Chunk[] {
  const lines = stripImages(md).split("\n");
  let lessonTitle = basename(file, ".md");
  let heading = "";
  let buf: string[] = [];
  const chunks: Chunk[] = [];
  let n = 0;

  const flush = () => {
    const text = buf.join("\n").trim();
    buf = [];
    if (text.length < 20) return;
    for (const piece of splitLong(text)) {
      chunks.push({ id: `${file}#${n++}`, file, lessonTitle, heading, text: piece });
    }
  };

  for (const line of lines) {
    const level = headingLevel(line);
    if (level === 1) {
      flush();
      lessonTitle = line.replace(/^#\s+/, "").trim();
      heading = "";
      buf.push(line);
    } else if (level === 2 || level === 3) {
      flush();
      heading = line.replace(/^#{2,3}\s+/, "").trim();
      buf.push(line);
    } else {
      buf.push(line);
    }
  }
  flush();
  return chunks;
}

export async function chunkAllLessons(lessonsDir: string): Promise<Chunk[]> {
  const files = (await readdir(lessonsDir)).filter((f) => f.endsWith(".md")).sort();
  const all: Chunk[] = [];
  for (const f of files) {
    const md = await Bun.file(join(lessonsDir, f)).text();
    all.push(...chunkLesson(f, md));
  }
  return all;
}

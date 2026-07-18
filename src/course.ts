/**
 * Course-pack loader. "Load your course once" = point the app at a folder shaped
 * like sample-course/ (syllabus.md + lessons/*.md). No DB, no accounts, no ingest.
 *
 * COURSE_DIR env var overrides the folder — load the real (gitignored) course with:
 *   COURSE_DIR=./real-course bun run app
 */

import { resolve, join, basename } from "node:path";
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface Lesson {
  id: string; // filename without extension, e.g. "01-linear-equations"
  title: string;
  content: string;
}

export interface CoursePack {
  dir: string;
  syllabus: string;
  lessons: Lesson[];
}

const firstHeading = (md: string, fallback: string): string => {
  const m = md.match(/^#\s+(.+)$/m);
  return m?.[1]?.trim() ?? fallback;
};

export async function loadCourse(dir?: string): Promise<CoursePack> {
  const courseDir = resolve(dir ?? process.env.COURSE_DIR ?? "./sample-course");
  const syllabusPath = join(courseDir, "syllabus.md");
  const syllabus = existsSync(syllabusPath) ? await Bun.file(syllabusPath).text() : "";

  const lessonsDir = join(courseDir, "lessons");
  const lessons: Lesson[] = [];
  if (existsSync(lessonsDir)) {
    const files = (await readdir(lessonsDir)).filter((f) => f.endsWith(".md")).sort();
    for (const f of files) {
      const content = await Bun.file(join(lessonsDir, f)).text();
      const id = basename(f, ".md");
      lessons.push({ id, title: firstHeading(content, id), content });
    }
  }
  return { dir: courseDir, syllabus, lessons };
}

/**
 * lookup_course tool body: naive but effective keyword retrieval over the pack.
 * TODO(sat): rank by term frequency / return the most relevant lesson section
 * instead of whole files if context gets tight.
 */
export function lookupCourse(pack: CoursePack, query: string): string {
  // Keyword scoring, not whole-phrase substring — "solve quadratic equations"
  // should still match a lesson that says "quadratic".
  const tokens = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2);
  const score = (text: string): number => {
    const lc = text.toLowerCase();
    return tokens.reduce((n, t) => n + (lc.includes(t) ? 1 : 0), 0);
  };

  const sections = [
    { title: "syllabus", content: pack.syllabus },
    ...pack.lessons.map((l) => ({ title: l.title, content: l.content })),
  ]
    .map((s) => ({ ...s, s: score(`${s.title}\n${s.content}`) }))
    .filter((s) => s.s > 0)
    .sort((a, b) => b.s - a.s);

  if (sections.length === 0) {
    return `No course material matched "${query}". Available lessons: ${pack.lessons
      .map((l) => l.title)
      .join("; ")}.`;
  }
  // Return the top couple of sections, capped so we don't blow the context window.
  return sections
    .slice(0, 2)
    .map((s) => `## From ${s.title}\n\n${s.content}`)
    .join("\n\n---\n\n")
    .slice(0, 6000);
}

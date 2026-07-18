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
  const q = query.toLowerCase().trim();
  const hits: string[] = [];

  if (pack.syllabus.toLowerCase().includes(q)) {
    hits.push(`## From syllabus\n\n${pack.syllabus}`);
  }
  for (const lesson of pack.lessons) {
    if (lesson.title.toLowerCase().includes(q) || lesson.content.toLowerCase().includes(q)) {
      hits.push(`## From lesson: ${lesson.title}\n\n${lesson.content}`);
    }
  }
  if (hits.length === 0) {
    return `No course material matched "${query}". Available lessons: ${pack.lessons
      .map((l) => l.title)
      .join("; ")}.`;
  }
  // Cap returned context so we don't blow the model's window on a broad query.
  return hits.join("\n\n---\n\n").slice(0, 6000);
}

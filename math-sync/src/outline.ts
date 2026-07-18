/**
 * Course outline (Units → Lessons) for the navigator sidebar.
 *
 * Units come from the syllabus: every `##` section that links to lessons/*.md
 * becomes a unit, in syllabus order. Conventions handled:
 *  - a lone generic "## Lessons" heading (sample-course shape) takes the H1 title
 *  - Buzz-export shape: no links at all, but `## Unit N:` headings + lesson files
 *    named <unit>-<lesson>-<slug>.md → group by id prefix, numeric order
 *  - lessons on disk but never referenced land in a trailing "More lessons" unit
 *  - no syllabus / no links at all → one unit with every loaded lesson
 * Lesson titles always come from the loaded lesson file, not the link text.
 */

import type { Lesson } from "./course.ts";

export interface OutlineLesson {
  id: string;
  title: string;
}

export interface OutlineUnit {
  title: string;
  lessons: OutlineLesson[];
}

const LESSON_LINK = /\[[^\]]*\]\((?:\.\/)?lessons\/([^)#\s]+?)\.md\)/g;
const HEADING = /^(#{1,2})\s+(.+?)\s*$/;

export function buildOutline(syllabus: string, lessons: Lesson[]): OutlineUnit[] {
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const courseTitle = syllabus.match(/^#\s+(.+)$/m)?.[1]?.trim() || "Course";

  // Walk the syllabus, grouping lesson links under the nearest `##` heading.
  const sections: Array<{ heading: string; ids: string[] }> = [];
  let current: { heading: string; ids: string[] } | null = null;
  const seen = new Set<string>();
  for (const line of syllabus.split("\n")) {
    const h = line.match(HEADING);
    if (h?.[1] === "##") {
      current = { heading: h[2] ?? "", ids: [] };
      sections.push(current);
      continue;
    }
    for (const m of line.matchAll(LESSON_LINK)) {
      const id = m[1] ?? "";
      if (!byId.has(id) || seen.has(id)) continue;
      seen.add(id);
      if (!current) {
        current = { heading: "", ids: [] };
        sections.push(current);
      }
      current.ids.push(id);
    }
  }

  const toLesson = (id: string): OutlineLesson => {
    const l = byId.get(id);
    return { id, title: l?.title ?? id };
  };

  const units: OutlineUnit[] = sections
    .filter((s) => s.ids.length > 0)
    .map((s) => ({
      // A bare/generic "Lessons" heading isn't a real unit name — use the course title.
      title: !s.heading || /^lessons$/i.test(s.heading) ? courseTitle : s.heading,
      lessons: s.ids.map(toLesson),
    }));

  // Buzz-export shape: `## Unit N: …` headings but plain-text bullets, no links.
  // Group lessons by their `<unitN>-` id prefix, in syllabus heading order,
  // numerically within a unit (10-2 before 10-11).
  if (units.length === 0) {
    const UNIT_HEADING = /^Unit\s+(\d+)\b/i;
    const LESSON_ID = /^(\d+)-(\d+)\b/;
    for (const s of sections) {
      const unitNo = s.heading.match(UNIT_HEADING)?.[1];
      if (!unitNo) continue;
      const members = lessons
        .filter((l) => l.id.match(LESSON_ID)?.[1] === unitNo && !seen.has(l.id))
        .sort((a, b) => Number(a.id.match(LESSON_ID)?.[2]) - Number(b.id.match(LESSON_ID)?.[2]));
      if (members.length === 0) continue;
      for (const l of members) seen.add(l.id);
      units.push({
        // Strip trailing decorations like "👈 **current unit**" from the heading.
        title: s.heading.replace(/\s*👈.*$/u, "").trim(),
        lessons: members.map((l) => ({ id: l.id, title: l.title })),
      });
    }
  }

  const leftover = lessons.filter((l) => !seen.has(l.id));
  if (units.length === 0) {
    return lessons.length > 0
      ? [{ title: courseTitle, lessons: lessons.map((l) => ({ id: l.id, title: l.title })) }]
      : [];
  }
  if (leftover.length > 0) {
    units.push({ title: "More lessons", lessons: leftover.map((l) => ({ id: l.id, title: l.title })) });
  }
  return units;
}

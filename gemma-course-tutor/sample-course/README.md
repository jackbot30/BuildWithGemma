# sample-course/ — bundled demo course (original, freely redistributable)

This is a **tiny, self-contained sample course** written from scratch for this
repository so the tutor and eval harness run **out of the box on a fresh clone** —
no copyrighted material required.

- It contains a short syllabus, a few original lessons on generic algebra and
  coordinate geometry, and a two-problem eval set with ground-truth answers.
- Every word here is original and is licensed the same as the rest of this repo.
  It is safe to commit, publish, and embed.

## Why it exists

The full course pack this app was developed against is copyrighted personal study
material and is **excluded from git** (see [`../course-pack/README.md`](../course-pack/README.md)).
Without a bundled fallback, a fresh clone would have no runnable course and
`bun run tutor "..."` would fail. `src/config.ts` therefore falls back to this
folder automatically whenever `course-pack/` has no lessons.

## Shape (identical to a real course pack)

```
sample-course/
  syllabus.md            course outline
  lessons/*.md           one markdown file per lesson; math as $...$ / $$...$$ LaTeX
  eval/problems.json     [{ "id", "question", "expected", "type" }] ground-truth keys
```

To use your own (or the private) pack instead, populate `course-pack/` in this same
shape, or point `COURSE_PACK_DIR` at any directory — the code is content-agnostic.

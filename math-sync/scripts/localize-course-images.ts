/**
 * Localize external lesson images so the course renders fully offline.
 *
 * The Buzz export keeps images as https://iscontent.byu.edu/… references. This
 * script downloads each one into <courseDir>/assets/ (LOCAL personal-use copy,
 * same footing as the exported lesson text — the whole course dir is gitignored)
 * and rewrites the lesson markdown to `assets/<name>`, which the app serves at
 * /course-asset/<name>. Idempotent: already-local refs are untouched; existing
 * asset files are not re-downloaded.
 *
 *   COURSE_DIR=path bun run scripts/localize-course-images.ts
 */

import { createHash } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";

const IMAGE_REF = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;

export function findExternalImages(md: string): string[] {
  return [...md.matchAll(IMAGE_REF)].map((m) => m[1] ?? "").filter(Boolean);
}

/** Stable local filename: <url-basename>-<8-char url hash>[.ext]. */
export function assetNameFor(url: string): string {
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 8);
  const path = new URL(url).pathname;
  const base = path.split("/").filter(Boolean).pop() ?? "asset";
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[^\w.-]+/g, "_");
  const ext = dot > 0 ? base.slice(dot) : "";
  return `${stem}-${hash}${ext}`;
}

/** Rewrite refs whose URL is in the map (i.e. successfully downloaded) to assets/<name>. */
export function rewriteImageRefs(md: string, downloaded: Map<string, string>): string {
  return md.replace(IMAGE_REF, (whole, url: string) => {
    const name = downloaded.get(url);
    return name ? whole.replace(url, `assets/${name}`) : whole;
  });
}

async function main(): Promise<void> {
  const courseDir = resolve(process.env.COURSE_DIR ?? "./sample-course");
  const lessonsDir = join(courseDir, "lessons");
  const assetsDir = join(courseDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const files = (await readdir(lessonsDir)).filter((f) => f.endsWith(".md"));
  let downloaded = 0;
  let reused = 0;
  let failed = 0;

  for (const file of files) {
    const path = join(lessonsDir, file);
    const md = await Bun.file(path).text();
    const urls = [...new Set(findExternalImages(md))];
    if (urls.length === 0) continue;

    const ok = new Map<string, string>();
    for (const url of urls) {
      const name = assetNameFor(url);
      const dest = join(assetsDir, name);
      if (await Bun.file(dest).exists()) {
        ok.set(url, name);
        reused++;
        continue;
      }
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await Bun.write(dest, await res.arrayBuffer());
        ok.set(url, name);
        downloaded++;
      } catch (e) {
        failed++;
        console.error(`FAILED ${url} (${file}): ${e}`);
      }
    }
    const next = rewriteImageRefs(md, ok);
    if (next !== md) await Bun.write(path, next);
  }
  console.log(`done: ${downloaded} downloaded, ${reused} already local, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

if (import.meta.main) await main();

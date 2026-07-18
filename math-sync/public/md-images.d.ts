// Type declaration for the DOM-free markdown image transform so TypeScript
// callers (e.g. src/md-images.test.ts) get types without `any`. The runtime
// implementation lives in md-images.js.
export function transformImages(text: string): string;

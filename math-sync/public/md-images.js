// Shared, DOM-free markdown image transform. Kept separate from course-nav.js so
// it can be unit-tested without a browser. Three cases, applied in order:
//   1. Local course assets (assets/NAME) -> a served <img> via /course-asset/.
//   2. Network images (http/https)       -> an offline-safe <figure class="net-img">
//      placeholder that carries the URL in data-net-src and the alt text in a
//      <figcaption>, but has NO src. course-nav.js's syncNetworkImages() inserts
//      the real <img> only when navigator.onLine — so airplane mode never fires an
//      external request, while online mode shows the real diagram.
//   3. Anything else                      -> degrades to its alt text.
//
// Input is expected to be already HTML-escaped by the caller (mdToHtml escapes the
// whole document before splitting into lines), so alt text / URLs are safe to
// interpolate into attributes and text nodes here.

/**
 * @param {string} text  markdown fragment, already HTML-escaped
 * @returns {string}     HTML with images resolved per the rules above
 */
export function transformImages(text) {
  return text
    .replace(
      /!\[([^\]]*)\]\(assets\/([\w.-]+)\)/g,
      '<img src="/course-asset/$2" alt="$1" loading="lazy" />',
    )
    .replace(
      /!\[([^\]]*)\]\((https?:\/\/[^)]*)\)/g,
      '<figure class="net-img net-img--offline" data-net-src="$2"><figcaption>$1</figcaption></figure>',
    )
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
}

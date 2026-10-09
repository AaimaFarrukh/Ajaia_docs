// Allow-list HTML sanitizer. Documents are stored as a small, attribute-free
// subset of HTML so a stored document can never carry script, handlers or styles.
const ALLOWED = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'b', 'i', 'u', 'br', 'blockquote']);
const RENAME = { div: 'p', strong: 'b', em: 'i', h4: 'h3', h5: 'h3', h6: 'h3' };

export function sanitizeHtml(input) {
  const s = String(input ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '');
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|<[!?/][^>]*>|<|[^<]+/g;
  let out = '';
  for (const m of s.matchAll(re)) {
    if (m[2]) {
      let tag = m[2].toLowerCase();
      tag = RENAME[tag] || tag;
      if (!ALLOWED.has(tag)) continue;
      if (tag === 'br') { if (!m[1]) out += '<br>'; continue; }
      out += m[1] ? `</${tag}>` : `<${tag}>`;
    } else if (m[0] === '<') out += '&lt;';
    else if (m[0].startsWith('<')) continue;
    else out += m[0];
  }
  return out;
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function htmlToText(html) {
  return String(html)
    .replace(/<\/(p|h[1-3]|li|blockquote)>/g, ' ')
    .replace(/<br>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

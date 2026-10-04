// Accent-insensitive matching for the command palette, quick replies and message search:
// "cafe" finds "Café", "jdoe" finds "John Doe".

/** Lowercase without diacritics ("Café" → "cafe"). Keeps the length of most Latin text. */
export function fold(s = '') {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * How well `text` matches the (already folded) query. Lower is better, Infinity = no match.
 * Prefix < word start < substring < subsequence (tighter subsequences score better).
 */
export function fuzzyScore(text, q) {
  if (!q) return 0;
  const n = fold(text);
  if (n.startsWith(q)) return 0;
  if (n.includes(` ${q}`)) return 0.5;
  const idx = n.indexOf(q);
  if (idx >= 0) return 1 + idx / 100;
  let j = 0, first = -1, last = -1;
  for (let i = 0; i < n.length && j < q.length; i++) {
    if (n[i] === q[j]) { if (first < 0) first = i; last = i; j++; }
  }
  return j === q.length ? 3 + (last - first - q.length) / 50 : Infinity;
}

/** Best score of a query over several strings (name, keywords…). */
export function bestScore(texts, q) {
  let best = Infinity;
  for (const t of texts) if (t) best = Math.min(best, fuzzyScore(t, q));
  return best;
}

/**
 * Split `text` into [{ text, hit }] pieces with every occurrence of the query's words marked,
 * ignoring case and accents. Works on the original string so accents survive in the output.
 */
export function highlight(text = '', query = '') {
  const words = fold(query).split(/\s+/).filter((w) => w.length > 0);
  if (!words.length || !text) return [{ text, hit: false }];
  // Map folded positions back to the original: fold char by char.
  let folded = '';
  const origin = [];
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i]);
    for (let k = 0; k < f.length; k++) { folded += f[k]; origin.push(i); }
  }
  const marks = new Array(text.length).fill(false);
  for (const w of words) {
    let from = 0;
    for (let at = folded.indexOf(w, from); at >= 0; at = folded.indexOf(w, from)) {
      for (let k = at; k < at + w.length; k++) marks[origin[k]] = true;
      from = at + w.length;
    }
  }
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === marks[i]) last.text += text[i];
    else out.push({ text: text[i], hit: marks[i] });
  }
  return out;
}

/** A ~`size`-char window of `text` around the first match, with ellipses. */
export function snippet(text = '', query = '', size = 140) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= size) return flat;
  const words = fold(query).split(/\s+/).filter(Boolean);
  const f = fold(flat);
  const at = words.reduce((m, w) => { const i = f.indexOf(w); return i >= 0 && (m < 0 || i < m) ? i : m; }, -1);
  if (at < size / 2) return flat.slice(0, size).trimEnd() + '…';
  const start = Math.max(0, at - Math.floor(size / 3));
  const end = Math.min(flat.length, start + size);
  return (start > 0 ? '…' : '') + flat.slice(start, end).trim() + (end < flat.length ? '…' : '');
}


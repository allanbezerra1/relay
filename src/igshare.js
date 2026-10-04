// The Instagram (mautrix-meta) bridge writes shared posts/reels and story replies as Markdown
// as Markdown: "**author caption**\n[url](url)", "> Replied to @Ana's story\n\n[url](url)", …
// Relay shows them as cards instead of raw links. Matches the bridge's exact wording.

const MD_LINK = /^\[(https?:\/\/[^\]\s]+)\]\((https?:\/\/[^)\s]+)\)$/;
const IG = /^https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv|stories)\//i;

function link(line) {
  const m = MD_LINK.exec((line || '').trim());
  return m && IG.test(m[1]) ? { url: m[2], short: m[1] } : null;
}

const KIND = (url) => (/\/(reel|reels|tv)\//i.test(url) ? 'reel' : /\/stories\//i.test(url) ? 'story' : 'post');

/**
 * { type: 'share', kind: 'post'|'reel', author, caption, url } for a shared post/reel,
 * { type: 'story', action, who, available, url, text } for story replies/reactions/mentions/shares,
 * or null.
 */
export function igParse(body) {
  if (typeof body !== 'string' || body.length > 4000) return null;
  const b = body.trim();

  // Story context: "> Replied to @Ana's story\n\n[url](url)" or "…\n\nStory unavailable" (+ optional own text after).
  const sm = /^> (Replied to @(.+?)'s story|Reacted to @(.+?)'s story|Mentioned you in their story|Shared (.+?)'s story)\n\n([\s\S]*)$/.exec(b);
  if (sm) {
    const [, phrase, replied, reacted, shared, rest] = sm;
    const lines = rest.split('\n');
    const l = link(lines[0]);
    const action = phrase.startsWith('Replied') ? 'replied' : phrase.startsWith('Reacted') ? 'reacted' : phrase.startsWith('Mentioned') ? 'mentioned' : 'shared';
    return {
      type: 'story', action, who: replied || reacted || shared || null,
      available: !!l || !/^Story unavailable/i.test(lines[0] || ''),
      url: l?.url || null,
      text: lines.slice(l || /^Story unavailable/i.test(lines[0] || '') ? 1 : 0).join('\n').trim(),
    };
  }

  // Shared post/reel: optional "**author caption**" line, then the link.
  const lines = b.split('\n');
  const l = link(lines.at(-1));
  if (l && lines.length <= 2) {
    let author = null, caption = '';
    if (lines.length === 2) {
      const bold = /^\*\*([\s\S]*)\*\*$/.exec(lines[0].trim());
      if (!bold) return null;
      const words = bold[1].trim().split(/\s+/);
      if (/^[a-z0-9._]{2,30}$/i.test(words[0])) { author = words[0]; caption = words.slice(1).join(' '); }
      else caption = bold[1];
    }
    return { type: 'share', kind: KIND(l.short), author, caption, url: l.url };
  }
  return null;
}

/** The "> Replied to @Ana's story" line the bridge puts only in formatted_body of the reply text. */
export function igStoryContext(formatted) {
  const m = /^<blockquote>(Replied to @(.+?)&#39;s story|Reacted to @(.+?)&#39;s story|Mentioned you in their story)<\/blockquote>/.exec(formatted || '');
  if (!m) return null;
  return { action: m[1].startsWith('Replied') ? 'replied' : m[1].startsWith('Reacted') ? 'reacted' : 'mentioned', who: m[2] || m[3] || null };
}

const first = (name) => (name || '').split(/\s+/)[0];

const same = (a, b) => !!a && !!b && first(a).toLowerCase() === first(b).toLowerCase();

export function storyLabel(s, mine, myName) {
  const who = s.who ? first(s.who) : null;
  const yours = same(s.who, myName);
  switch (s.action) {
    case 'replied': return mine ? `You replied to ${who}’s story` : `Replied to ${who && !yours ? `${who}’s story` : 'your story'}`;
    case 'reacted': return mine ? `You reacted to ${who}’s story` : `Reacted to ${who && !yours ? `${who}’s story` : 'your story'}`;
    case 'mentioned': return mine ? 'You mentioned them in your story' : 'Mentioned you in their story';
    default: return `Shared ${who ? `${who}’s` : 'a'} story`;
  }
}

/** Short line for the chat list. */
export function igPreview(body, myName) {
  const p = igParse(body);
  if (!p) return null;
  if (p.type === 'share') return `${p.kind === 'reel' ? '🎬 Reel' : '📷 Post'}${p.author ? ` by @${p.author}` : ''}`;
  return `📖 ${storyLabel(p, false, myName)}${p.text ? `: ${p.text}` : ''}`;
}

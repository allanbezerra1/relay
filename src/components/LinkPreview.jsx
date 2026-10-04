import { useEffect, useState } from 'react';
import { mediaUrl } from '../matrix.js';
import { usePrefs } from '../prefs.js';

// Rich link previews under messages, from the homeserver's URL preview API
// (Synapse fetches the page, so the app never contacts the site itself).
// One preview per message: the first link. Results are cached for the session.

const cache = new Map(); // url -> Promise<og | null>

function fetchPreview(client, url, ts) {
  if (!cache.has(url)) {
    const p = client.getUrlPreview(url, ts)
      .then((og) => (og && (og['og:title'] || og['og:description'] || og['og:image']) ? og : null))
      .catch(() => null);
    cache.set(url, p);
  }
  return cache.get(url);
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^(www|m|mobile)\./, ''); } catch { return ''; }
}

/** YouTube / Instagram / X get their own badge color, and videos a play button. */
function kindOf(url, og) {
  const host = hostOf(url);
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return { id: 'youtube', name: 'YouTube', video: true };
  if (/(^|\.)instagram\.com$/.test(host)) return { id: 'instagram', name: 'Instagram', video: /\/(reel|reels|tv)\//.test(url) };
  if (/(^|\.)(twitter|x)\.com$/.test(host)) return { id: 'x', name: 'X' };
  if (/(^|\.)tiktok\.com$/.test(host)) return { id: 'tiktok', name: 'TikTok', video: true };
  if (/(^|\.)spotify\.com$/.test(host)) return { id: 'spotify', name: 'Spotify' };
  return { id: 'web', name: og?.['og:site_name'] || host, video: /^video/.test(og?.['og:type'] || '') };
}

function hue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

const BRAND_ICON = {
  youtube: <svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M9 7.5v9l7.5-4.5L9 7.5Z" /></svg>,
  x: <svg viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.5l11.2 14.5Z" /></svg>,
  instagram: <svg viewBox="0 0 24 24" width="11" height="11"><path fill="none" stroke="currentColor" strokeWidth="2.4" d="M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Zm5 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm5.5-1.5h0" /></svg>,
};

// Like Element: in encrypted chats, don't send links to a remote server just for a preview
// (Aurora's own local server is fine, it's on this computer).
const isLocalServer = (client) => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(client?.baseUrl || '');

/** Short form of a link for display: "instagram.com/stories/gabriella…". */
export function shortUrl(url) {
  try {
    const u = new URL(url);
    const rest = (u.pathname + (u.search ? '?…' : '')).replace(/\/$/, '');
    const s = u.hostname.replace(/^(www|m|mobile)\./, '') + rest;
    return s.length > 42 ? `${s.slice(0, 40)}…` : s;
  } catch { return url.length > 42 ? `${url.slice(0, 40)}…` : url; }
}

// Instagram's page titles are long and repetitive ("Watch this story by X on Instagram…").
function tidy(kind, title, desc) {
  if (kind.id !== 'instagram') return [title, desc];
  let t = title || '', d = desc || '';
  let m;
  if ((m = /^Watch this story by (.+?) on Instagram/i.exec(t))) t = `${m[1]}’s story`;
  else if ((m = /^(.+?) on Instagram:\s*["“](.*)["”]\s*$/is.exec(t))) { t = m[1]; d = d || m[2]; }
  else if ((m = /^(.+?) \(@([\w.]+)\) • Instagram/i.exec(t))) t = `${m[1]} (@${m[2]})`;
  d = d.replace(/ - See Instagram photos and videos from .*$/i, '');
  return [t, d];
}

/**
 * `standalone`: the message is just this link, so the card stands in for the text; while loading
 * or if there's no preview, the short link is shown instead.
 */
export default function LinkPreview({ client, room, url, ts, mine, standalone = false }) {
  const prefs = usePrefs();
  const [og, setOg] = useState(null);
  const [imgOk, setImgOk] = useState(true);
  const enabled = prefs.linkPreviews !== false && !!url && !!client?.getUrlPreview
    && (isLocalServer(client) || !room?.hasEncryptionStateEvent());

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchPreview(client, url, ts).then((r) => alive && setOg(r));
    return () => { alive = false; };
  }, [enabled, client, url]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled || !og) {
    return standalone ? <a className="lp-fallback" href={url} target="_blank" rel="noreferrer" title={url} onClick={(e) => e.stopPropagation()}>{shortUrl(url)}</a> : null;
  }
  const kind = kindOf(url, og);
  const rawDesc = og['og:description'] && og['og:description'] !== og['og:title'] ? og['og:description'].replace(/\s+/g, ' ').trim() : '';
  const [title, desc] = tidy(kind, og['og:title'], rawDesc);
  const image = imgOk && og['og:image'] ? mediaUrl(client, og['og:image']) : null;
  const w = Number(og['og:image:width']) || 0;
  const h = Number(og['og:image:height']) || 0;
  // Wide pictures (and every video) go on top; small or square ones become a thumbnail.
  const hero = !!image && (kind.video || (w >= 400 && (!h || w / h >= 1.3)));
  const host = hostOf(url);
  const site = kind.id === 'web' ? (og['og:site_name'] || host) : kind.name;
  // The badge letter: the site's name, or the main part of the domain (pt.wikipedia.org → W).
  const label = og['og:site_name'] || host.split('.').slice(-2, -1)[0] || host;
  const letter = (label || '?').replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase() || '?';

  return (
    <a className={`link-preview lp-${kind.id} ${hero ? 'hero' : image ? 'thumb' : 'plain'} ${mine ? 'mine' : ''} ${standalone ? 'standalone' : ''} ${h > w * 1.2 ? 'portrait' : ''}`}
      href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={url}>
      {hero && (
        <span className="lp-media" style={kind.video || !w || !h ? undefined : { aspectRatio: Math.min(2, Math.max(1.45, w / h)) }}>
          <img src={image} alt="" draggable={false} loading="lazy" onError={() => setImgOk(false)} />
          {kind.video && <span className="lp-play"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg></span>}
        </span>
      )}
      <span className="lp-body">
        <span className="lp-site">
          <span className="lp-favicon" style={{ '--h': hue(site || '') }}>{BRAND_ICON[kind.id] || letter}</span>
          <span className="lp-site-name">{site}</span>
        </span>
        {title && <span className="lp-title">{title}</span>}
        {desc && <span className="lp-desc">{desc}</span>}
      </span>
      {!hero && image && (
        <span className="lp-thumb"><img src={image} alt="" draggable={false} loading="lazy" onError={() => setImgOk(false)} /></span>
      )}
    </a>
  );
}

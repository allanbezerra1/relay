import { Fragment, useEffect, useRef, useState } from 'react';
import { useContextMenu } from './ContextMenu.jsx';
import { askReminder, remindersAvailable } from '../reminders.js';
import { ReminderChip } from './Reminders.jsx';
import { EventStatus, EventType, MsgType } from 'matrix-js-sdk';
import Avatar from './Avatar.jsx';
import VoicePlayer, { fmt } from './VoicePlayer.jsx';
import { player } from '../player.js';
import EmojiPicker from './EmojiPicker.jsx';
import SmartCards from './SmartCards.jsx';
import { smartItems } from '../smart.js';
import { getPrefs } from '../prefs.js';
import { useMedia, copyImage } from '../media.js';
import { saveSticker, removeSticker, findSaved } from '../stickers.js';
import {
  effectiveContent, replyToId, stripReplyFallback, reactionsFor,
  senderName, previewText, formatBytes, memberAvatar, cleanName,
} from '../matrix.js';
import LinkPreview, { shortUrl } from './LinkPreview.jsx';
import { igBody, igCaption } from './IgCards.jsx';
import { igParse, igStoryContext } from '../igshare.js';
import { useAiReadyQuiet } from '../ai.js';
import { translatableBody, translateEvent } from '../translate.js';
import { MessageTranslation, TRANSLATE_PATH } from './Translate.jsx';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s){1,12}$/u;

const I = {
  reply: 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z',
  bell: 'M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z',
  smile: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm-3.5-9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM12 17.5c2.3 0 4.3-1.4 5.1-3.5H6.9c.8 2.1 2.8 3.5 5.1 3.5Z',
  download: 'M5 20h14v-2H5v2Zm7-3 6-6-1.4-1.4-3.6 3.6V3h-2v10.2l-3.6-3.6L6 11l6 6Z',
  forward: 'M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11Z',
  thread: 'M4 4h16v10H7l-3 3V4Zm3 13h10l3 3V8h-2v8H7v1Z',
  select: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9Z',
  star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27Z',
  starOutline: 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24ZM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4Z',
};

/** A stable, readable color per sender, like WhatsApp groups. */
function nameColor(id = '') {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 70% 62%)`;
}

function Svg({ d, size = 16 }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
}

// Mentions: bridges put them in formatted_body as matrix.to links (the plain body
// just has the name, often with a " (WA)" suffix). Highlight those names.
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function mentionsOf(content) {
  const html = content?.formatted_body || '';
  return [...html.matchAll(/<a href="https:\/\/matrix\.to\/#\/(@[^"]+)">([^<]+)<\/a>/g)]
    .map((m) => ({ userId: decodeURIComponent(m[1]), text: decode(m[2]) }));
}

function Mentions({ text, mentions, me }) {
  if (!mentions?.length) return text;
  const re = new RegExp(`(${mentions.map((m) => escapeRe(m.text)).join('|')})`, 'g');
  return text.split(re).map((p, i) => {
    const m = i % 2 ? mentions.find((x) => x.text === p) : null;
    if (!m) return p;
    const name = cleanName(p.replace(/^@/, ''));
    return <span key={i} className={`mention ${m.userId === me ? 'me' : ''}`}>{name.startsWith('@') ? name : `@${name}`}</span>;
  });
}

// WhatsApp-style formatting written as plain text: *bold* / **bold** (Instagram sends Markdown),
// _italic_, ~strikethrough~, `code` and ```blocks```. Like WhatsApp, a marker only counts at a
// word boundary, so "2*3*4" or snake_case stay as they are.
const FMT = /(```[\s\S]+?```|`[^`\n]+`|\*\*(?=\S)[\s\S]+?\S\*\*|(?<![\w*])\*(?=\S)[^*\n]*?\S\*(?![\w*])|(?<![\w_])_(?=\S)[^_\n]*?\S_(?![\w_])|(?<![\w~])~(?=\S)[^~\n]*?\S~(?![\w~]))/;

function Formatted({ text, render }) {
  const parts = text.split(FMT);
  if (parts.length === 1) return render(text);
  return parts.map((p, i) => {
    if (i % 2 === 0) return p ? <Fragment key={i}>{render(p)}</Fragment> : null;
    if (p.startsWith('```')) return <code key={i} className="fmt-block">{p.slice(3, -3).replace(/^\n/, '')}</code>;
    if (p.startsWith('`')) return <code key={i} className="fmt-code">{p.slice(1, -1)}</code>;
    if (p.startsWith('**')) return <strong key={i}><Formatted text={p.slice(2, -2)} render={render} /></strong>;
    const inner = <Formatted text={p.slice(1, -1)} render={render} />;
    if (p[0] === '*') return <strong key={i}>{inner}</strong>;
    if (p[0] === '_') return <em key={i}>{inner}</em>;
    return <s key={i}>{inner}</s>;
  });
}

function Linkified({ text, mentions, me }) {
  const parts = text.split(URL_RE);
  return parts.map((p, i) =>
    i % 2 ? <a key={i} href={p} target="_blank" rel="noreferrer" title={p}>{shortUrl(p)}</a>
      : <Formatted key={i} text={p} render={(t) => <Mentions text={t} mentions={mentions} me={me} />} />,
  );
}

/** Time + delivery ticks, shown inside the bubble like WhatsApp. */
function Meta({ time, mine, receipt: receiptInfo, edited, overlay, starred }) {
  const receipt = receiptInfo?.state ?? receiptInfo;
  return (
    <span className={`meta ${overlay ? 'on-media' : ''}`} title={mine && receiptInfo?.title ? receiptInfo.title : undefined}>
      {starred && <svg className="meta-star" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d={I.star} /></svg>}
      {edited && <span className="meta-edited">edited</span>}
      <span>{time}</span>
      {mine && receipt === 'sending' && (
        <svg className="tick" viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7Z" /></svg>
      )}
      {mine && receipt === 'sent' && (
        <svg className="tick" viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" /></svg>
      )}
      {mine && receipt === 'delivered' && (
        <svg className="tick" viewBox="0 0 28 24" width="18" height="15"><path fill="currentColor" d="M7.5 16.2 3.3 12l-1.4 1.4L7.5 19l12-12-1.4-1.4L7.5 16.2Zm6.6 0-1-1-1.4 1.4 2.4 2.4 12-12-1.4-1.4-10.6 10.6Z" /></svg>
      )}
      {mine && receipt === 'failed' && (
        <svg className="tick failed" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 5h2v7h-2V7Zm0 9h2v2h-2v-2Z" /></svg>
      )}
      {mine && receipt === 'read' && (
        <svg className="tick read" viewBox="0 0 28 24" width="18" height="15"><path fill="currentColor" d="M7.5 16.2 3.3 12l-1.4 1.4L7.5 19l12-12-1.4-1.4L7.5 16.2Zm6.6 0-1-1-1.4 1.4 2.4 2.4 12-12-1.4-1.4-10.6 10.6Z" /></svg>
      )}
    </span>
  );
}

/** Who read your message, with when. */
function SeenList({ readers, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const esc = (e) => e.key === 'Escape' && onClose();
    setTimeout(() => window.addEventListener('mousedown', close), 0);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [onClose]);
  return (
    <div className="seen-list" ref={ref}>
      <div className="seen-title">{readers.length ? `Seen by ${readers.length}` : 'Nobody has seen it yet'}</div>
      {readers.map((r) => (
        <div key={r.userId} className="seen-row">
          <Avatar src={r.avatar} name={r.name} id={r.userId} size={28} />
          <span className="seen-name">{r.name}</span>
          <span className="seen-when">{r.when}</span>
        </div>
      ))}
    </div>
  );
}

function Caption({ content, client, mine }) {
  const myName = client?.getUser(client.getUserId())?.displayName;
  // Bridges put the caption in `body` and the file name in `filename`.
  const caption = content.filename && content.body && content.body !== content.filename ? content.body : null;
  if (!caption) return null;
  return igCaption(caption, { mine, myName }) || <div className="caption"><Linkified text={caption} /></div>;
}

function ImageBody({ client, content, onOpen, meta, sticker }) {
  const thumb = useMedia(client, content, { thumb: true });
  const full = useMedia(client, content);
  const src = thumb.url || full.url;
  const { w, h } = content.info || {};
  const maxW = sticker ? 180 : 340, maxH = sticker ? 180 : 380;
  const scale = w && h ? Math.min(1, maxW / w, maxH / h) : 1;
  const style = w && h ? { width: Math.max(140, Math.round(w * scale)), height: Math.round(h * scale) } : { width: 260, height: 200 };

  if (thumb.error && full.error) return <div className="media-error">🖼 Couldn’t load image</div>;
  return (
    <>
      <div className={`media image ${sticker ? 'sticker' : ''}`} style={style} onClick={() => full.url && onOpen({ src: full.url, name: content.filename || content.body })}>
        {src ? <img src={src} alt="" draggable={false} /> : <div className="media-loading" />}
        {!sticker && !hasCaption(content) && meta}
      </div>
      <Caption content={content} client={client} mine={mine} />
    </>
  );
}

const hasCaption = (c) => !!(c.filename && c.body && c.body !== c.filename);

const VIDEO_ICON = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  cam: 'M4 6h11a2 2 0 0 1 2 2v1.5l3.4-2.3A1 1 0 0 1 22 8v8a1 1 0 0 1-1.6.8L17 14.5V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z',
  sound: 'M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4ZM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6Z',
  muted: 'M3 9v6h4l5 5V4L7 9H3Zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4-2.7-2.7Z',
  full: 'M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z',
};

/** WhatsApp/Beeper-style video: poster with a play button and the length; plays inline with a slim bar. */
function VideoBody({ client, content, meta }) {
  const { url, error } = useMedia(client, content);
  // Only a real thumbnail: without one, useMedia falls back to the video file itself.
  const hasThumb = !!(content.info?.thumbnail_url || content.info?.thumbnail_file);
  const thumb = useMedia(client, content, { thumb: true }).url;
  const poster = hasThumb ? thumb : null;
  const ref = useRef(null);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState((content.info?.duration || 0) / 1000);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const { w, h } = content.info || {};
  const scale = w && h ? Math.min(1, 340 / w, 380 / h) : 1;
  const style = w && h ? { width: Math.max(200, Math.round(w * scale)), height: Math.round(h * scale) } : { width: 300, height: 200 };

  const toggle = (e) => {
    e?.stopPropagation();
    const v = ref.current;
    if (!v) return;
    if (v.paused) { player.pause(); v.play().catch(() => {}); setStarted(true); } else v.pause();
  };
  const seek = (e) => {
    e.stopPropagation();
    const v = ref.current;
    const r = e.currentTarget.getBoundingClientRect();
    if (v && dur) v.currentTime = Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur));
  };

  if (error) return <div className="media-error">🎥 Couldn’t load video</div>;
  return (
    <>
      <div className={`media video ${started ? 'started' : ''} ${playing ? 'playing' : ''}`} style={style} onClick={toggle} onDoubleClick={(e) => e.stopPropagation()}>
        {url ? (
          <video
            ref={ref}
            src={url}
            poster={poster || undefined}
            preload="metadata"
            playsInline
            controls={fullscreen}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (Number.isFinite(v.duration)) setDur(v.duration);
              if (!poster && v.currentTime === 0) v.currentTime = Math.min(0.1, v.duration || 0.1); // paint the first frame
            }}
            onEnded={(e) => { e.currentTarget.currentTime = 0; setStarted(false); setTime(0); }}
          />
        ) : <div className="media-loading" />}
        {!playing && url && <span className="video-play"><Svg d={VIDEO_ICON.play} size={26} /></span>}
        {!started && dur > 0 && <span className="video-dur"><Svg d={VIDEO_ICON.cam} size={13} />{fmt(dur)}</span>}
        {started && (
          <div className="video-bar" onClick={(e) => e.stopPropagation()}>
            <button onClick={toggle} title={playing ? 'Pause' : 'Play'}><Svg d={playing ? VIDEO_ICON.pause : VIDEO_ICON.play} size={15} /></button>
            <span className="video-time">{fmt(time)} / {fmt(dur)}</span>
            <div className="video-seek" onClick={seek}><i style={{ width: `${dur ? (time / dur) * 100 : 0}%` }} /></div>
            <button onClick={() => { const v = ref.current; if (v) { v.muted = !v.muted; setMuted(v.muted); } }} title={muted ? 'Unmute' : 'Mute'}>
              <Svg d={muted ? VIDEO_ICON.muted : VIDEO_ICON.sound} size={15} />
            </button>
            <button onClick={() => ref.current?.requestFullscreen?.()} title="Full screen"><Svg d={VIDEO_ICON.full} size={14} /></button>
          </div>
        )}
        {!started && !hasCaption(content) && meta}
      </div>
      <Caption content={content} client={client} mine={mine} />
    </>
  );
}

// File types: a friendly name and a color for the document icon.
const FILE_KINDS = [
  [/^pdf$/, 'PDF document', '#ef4444'],
  [/^(xlsx?|xlsm|csv|ods|numbers)$/, 'Spreadsheet', '#16a34a'],
  [/^(docx?|odt|rtf|pages)$/, 'Document', '#2563eb'],
  [/^(pptx?|odp|key)$/, 'Presentation', '#ea580c'],
  [/^(zip|rar|7z|tar|gz|tgz|bz2|xz)$/, 'Archive', '#d97706'],
  [/^(mp3|m4a|ogg|opus|wav|flac|aac)$/, 'Audio', '#9333ea'],
  [/^(mp4|mov|mkv|avi|webm|3gp)$/, 'Video', '#7c3aed'],
  [/^(jpe?g|png|gif|webp|heic|svg|bmp|tiff?)$/, 'Image', '#0891b2'],
  [/^(txt|md|log)$/, 'Text', '#64748b'],
  [/^(json|js|ts|jsx|tsx|py|html|css|xml|sql|sh|yml|yaml|go|rs|java|c|cpp)$/, 'Code', '#475569'],
  [/^(apk|exe|dmg|deb|appimage|msi|pkg)$/, 'Installer', '#334155'],
  [/^(ics)$/, 'Calendar invite', '#2563eb'],
  [/^(vcf)$/, 'Contact', '#0d9488'],
];
const fileKind = (ext) => { const k = FILE_KINDS.find(([re]) => re.test(ext)); return k ? { label: k[1], color: k[2] } : { label: 'File', color: '#64748b' }; };

function FileBody({ client, content }) {
  const { url } = useMedia(client, content);
  const name = content.filename || content.body || 'File';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const base = dot > 0 ? name.slice(0, dot) : name;
  const kind = fileKind(ext);
  const tag = ext && ext.length <= 4 ? ext.toUpperCase() : ext ? ext.slice(0, 3).toUpperCase() : '•••';
  return (
    <>
      <a className="file" href={url || undefined} download={name} target="_blank" rel="noreferrer" style={{ '--file': kind.color }} title={`Download ${name}`}>
        <span className="file-icon" aria-hidden="true">
          <svg viewBox="0 0 40 48" width="40" height="48">
            <path d="M5 0h21l14 14v29a5 5 0 0 1-5 5H5a5 5 0 0 1-5-5V5a5 5 0 0 1 5-5Z" fill="var(--file)" />
            <path d="M26 0v9a5 5 0 0 0 5 5h9Z" fill="#fff" fillOpacity="0.38" />
          </svg>
          <span className={tag.length > 3 ? 'long' : ''}>{tag}</span>
        </span>
        <span className="file-meta">
          <span className="file-name"><span className="file-base">{base}</span>{dot > 0 && <span className="file-ext">.{ext}</span>}</span>
          <span className="file-size">{[kind.label, formatBytes(content.info?.size)].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="file-dl"><Svg d={I.download} size={18} /></span>
      </a>
      <Caption content={content} client={client} mine={mine} />
    </>
  );
}

function Body({ client, room, ev, content, mine, onOpenImage, meta }) {
  if (ev.isRedacted()) return <span className="meta-text">🚫 Message deleted</span>;
  // WhatsApp never sends view-once media to linked devices; the bridge leaves a notice instead.
  if (content.msgtype === MsgType.Notice && /view once message/i.test(content.body || '')) {
    const sent = /You sent/i.test(content.body);
    return (
      <span className="view-once-msg">
        <span className="vo-circle">1</span>
        <span><b>View once message</b><small>{sent ? 'Sent from your phone' : 'Open it on your phone'}</small></span>
      </span>
    );
  }
  if (ev.isDecryptionFailure()) return <span className="meta-text">🔒 Unable to decrypt this message.</span>;
  if (ev.getType() === EventType.RoomMessageEncrypted) return <span className="meta-text">🔒 Decrypting…</span>;
  if (ev.getType() === EventType.Sticker) return <ImageBody client={client} content={content} onOpen={onOpenImage} sticker />;

  switch (content.msgtype) {
    case MsgType.Image: return <ImageBody client={client} content={content} onOpen={(x) => onOpenImage({ ...x, eventId: ev.getId() })} meta={meta} />;
    case MsgType.Video: return <VideoBody client={client} content={content} meta={meta} />;
    case MsgType.Audio: return <VoicePlayer client={client} content={content} id={ev.getId()} mine={mine} trailing={meta}
      who={{ name: senderName(room, ev.getSender()), avatar: memberAvatar(client, room, ev.getSender(), 64) }} />;
    case MsgType.File: return <FileBody client={client} content={content} />;
    case 'm.location': {
      const [lat, lon] = (content.geo_uri || '').replace('geo:', '').split(/[,;]/);
      return (
        <a className="location" href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`} target="_blank" rel="noreferrer">
          <span className="location-pin">📍</span>
          <span><b>Location</b><br />{content.body?.split('\n')[0] || `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`}</span>
        </a>
      );
    }
    case MsgType.Emote:
      return <span className="emote">* {senderName(room, ev.getSender())} <Linkified text={content.body || ''} /></span>;
    default: {
      // Instagram shares and story replies come as Markdown with raw links: show them as cards.
      const ig = content.msgtype === MsgType.Text && igBody(content, { mine, myName: client.getUser(client.getUserId())?.displayName });
      if (ig) return ig;
      const text = replyToId(ev) ? stripReplyFallback(content.body) : content.body || '';
      return <span className="text"><Linkified text={text} mentions={mentionsOf(content)} me={client.getUserId()} /></span>;
    }
  }
}

// ---------- Transcription (local whisper.cpp, via the main process) ----------
const TX_KEY = (id) => `relay.tx.${id}`;
let txAvailable = null;

function Transcribe({ client, ev, content, mine }) {
  const { url } = useMedia(client, content);
  const [text, setText] = useState(() => { try { return localStorage.getItem(TX_KEY(ev.getId())); } catch { return null; } });
  const [state, setState] = useState('idle'); // idle | working | error | unavailable
  const [error, setError] = useState(null);

  const run = async () => {
    if (txAvailable === null) txAvailable = await window.relay.canTranscribe?.().catch(() => ({ available: false }));
    if (!txAvailable?.available) { setState('unavailable'); return; }
    setState('working');
    try {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const result = (await window.relay.transcribe(bytes)) || '(no speech found)';
      setText(result);
      try { localStorage.setItem(TX_KEY(ev.getId()), result); } catch {}
      setState('idle');
    } catch (err) {
      setError(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      setState('error');
    }
  };

  if (text) {
    return (
      <div className={`transcript ${mine ? 'mine' : ''}`}>
        <span className="tx-label">✨ Transcription</span>
        <span className="tx-text">{text}</span>
      </div>
    );
  }
  return (
    <div className={`tx-row ${mine ? 'mine' : ''}`}>
      {state === 'working' ? (
        <span className="tx-link working"><span className="spinner small" /> Transcribing…</span>
      ) : state === 'unavailable' ? (
        <span className="tx-link muted">Install whisper.cpp to transcribe: brew install whisper-cpp</span>
      ) : (
        <button className="tx-link" disabled={!url} onClick={run}>
          <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="m9 4 1.5 4.5L15 10l-4.5 1.5L9 16l-1.5-4.5L3 10l4.5-1.5L9 4Zm8 8 .9 2.6 2.6.9-2.6.9L17 19l-.9-2.6-2.6-.9 2.6-.9L17 12Zm0-10 .6 1.7 1.7.6-1.7.6L17 6.6l-.6-1.7-1.7-.6 1.7-.6L17 2Z" /></svg>
          {state === 'error' ? `Couldn’t transcribe (${error}). Try again` : 'Try transcribing'}
        </button>
      )}
    </div>
  );
}

function ReplyQuote({ room, id, onOpen }) {
  const target = room.findEventById(id);
  return (
    <div className={`reply-quote ${onOpen ? 'clickable' : ''}`} onClick={onOpen ? (e) => { e.stopPropagation(); onOpen(); } : undefined}
      title={onOpen ? 'Show the whole thread' : undefined}>
      <span className="reply-name">{target ? senderName(room, target.getSender()) : 'Reply'}</span>
      <span className="reply-text">{target ? previewText(room, target, '').replace(/^[^:]+: /, '') : 'Original message not loaded'}</span>
    </div>
  );
}

function Message({
  client, room, ev, mine, continued, showSender, avatar, sender, receipt, starred,
  onReact, onReply, onEdit, onDelete, onRetry, onOpenImage, onStar,
  selecting, selected, onToggleSelect, onSelectStart, onForward,
  replies, onOpenThread, className = '', onOpenDirect, statusLine, onToast, seenBy,
}) {
  const [seenOpen, setSeenOpen] = useState(null); // readers list being shown
  const [picker, setPicker] = useState(false);
  const bubbleRef = useRef(null);

  // Reply gestures: double-click the empty space beside a message, or swipe it sideways
  // with two fingers on the trackpad (like WhatsApp / Beeper).
  const [swipe, setSwipe] = useState(0);
  const swipeRef = useRef({ offset: 0, timer: null });
  const SWIPE_AT = 56;
  const canReply = !ev.isRedacted() && !ev.status && !selecting;
  const onWheel = (e) => {
    if (!canReply || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5) return;
    const s = swipeRef.current;
    s.offset = Math.min(90, s.offset + Math.abs(e.deltaX));
    setSwipe(s.offset);
    clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      if (s.offset >= SWIPE_AT) onReply(ev);
      s.offset = 0;
      setSwipe(0);
    }, 140);
  };
  const onBlankClick = (e) => {
    if (!canReply || e.defaultPrevented) return;
    if (e.target.closest('.bubble, .msg-tools, .reactions, .msg-avatar, .msg-sender, .transcript, .tx-row, .tr-card, .menu, .emoji-picker, a, button')) return;
    window.getSelection()?.removeAllRanges(); // a double-click would select a word
    onReply(ev);
  };
  const [menuEl, openMenu] = useContextMenu();
  const content = effectiveContent(ev);
  const replyId = replyToId(ev);
  const reactions = reactionsFor(room, ev);
  const edited = !!ev.replacingEvent();
  const isSticker = ev.getType() === EventType.Sticker;
  const isImage = content.msgtype === MsgType.Image || isSticker;
  const isMedia = isImage || content.msgtype === MsgType.Video;
  const isAudio = content.msgtype === MsgType.Audio;
  const bigEmoji = content.msgtype === MsgType.Text && !replyId && EMOJI_ONLY.test(content.body || '') && !/^\s*[\d#*]+\s*$/.test(content.body);
  const failed = ev.status === EventStatus.NOT_SENT;
  const canEdit = mine && !ev.isRedacted() && content.msgtype === MsgType.Text && !ev.status;
  const time = new Date(ev.getTs()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const imageOverlay = ((isImage && !isSticker) || content.msgtype === MsgType.Video) && !hasCaption(content) && !replyId;
  const meta = <Meta time={time} mine={mine} receipt={failed ? null : receipt} edited={edited && !ev.isRedacted()} overlay={imageOverlay} starred={starred} />;
  const copyable = content.msgtype === MsgType.Text || content.msgtype === MsgType.Notice;
  // What "Translate" works on: people's words only, never bridge notices or view once placeholders.
  const aiReady = useAiReadyQuiet();
  const trBody = aiReady ? translatableBody(ev) : '';

  // Media in this bubble (blob or http URL), for Open / Save.
  const mediaEl = () => bubbleRef.current?.querySelector('img, video, audio, a.file');
  const mediaUrl = () => { const el = mediaEl(); return el?.currentSrc || el?.src || el?.href || null; };
  const saveMedia = () => {
    const url = mediaUrl();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = content.filename || content.body || 'file';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  // Instagram shares/story replies already render as their own card: no link preview on top.
  const igMsg = content.msgtype === MsgType.Text && !!(igParse(content.body) || igStoryContext(content.formatted_body));
  const link = (content.body || '').match(URL_RE)?.[0];
  const previewLink = igMsg ? null : link;
  // A message that is only a link shows just the preview card (WhatsApp-style), not the long URL.
  const linkOnly = !!previewLink && content.msgtype === MsgType.Text && !replyId && stripReplyFallback(content.body || '').trim() === link;
  // Smart cards (Pix, codes, tracking, dates, addresses) under text messages.
  const smartOn = copyable && !ev.isRedacted() && getPrefs().smartCards !== false;
  const smartText = smartOn ? stripReplyFallback(content.body || '') : '';
  // A Pix "copia e cola" is a wall of digits: the card shows it (and copies it), the text doesn't.
  const pix = smartOn && content.msgtype === MsgType.Text ? smartItems(smartText, ev.getTs()).find((x) => x.type === 'pix') : null;
  const shown = pix ? { ...content, body: (content.body || '').replace(pix.code, '').replace(/[\s:–-]+$/, '').trim(), formatted_body: undefined, format: undefined } : content;
  const pixOnly = !!pix && !stripReplyFallback(shown.body).trim();

  // Save / remove a sticker (or an image as a sticker) in "My stickers".
  const stickerItem = () => {
    if (!isImage || ev.status || !client) return null;
    const saved = findSaved(client, ev);
    const toast = (t) => onToast?.(t);
    if (saved) return { label: 'Remove from my stickers', icon: <span>🗑</span>, run: () => removeSticker(client, saved.id).then(() => toast('Removed from your stickers')) };
    return {
      label: isSticker ? 'Save sticker' : 'Add to my stickers',
      icon: <Svg d="M5 3h10l6 6v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm9 1.6V8a2 2 0 0 0 2 2h3.4L14 4.6Z" size={15} />,
      run: () => saveSticker(client, ev).then(() => toast('Saved to your stickers'), (err) => toast(`Couldn’t save: ${err.message}`)),
    };
  };

  const reminderTarget = () => ({
    roomId: room.roomId, eventId: ev.getId(), roomName: cleanName(room.name || ''),
    sender: mine ? 'You' : sender,
    text: copyable ? stripReplyFallback(content.body || '') : previewText(room, ev, client?.getUserId()).replace(/^[^:]+: /, ''),
  });
  const onContextMenu = (e) => {
    if (ev.isRedacted()) return;
    const sel = window.getSelection()?.toString();
    openMenu(e, [
      !ev.status && { reactions: QUICK_REACTIONS, onReact: (k) => onReact(ev, k) },
      !ev.status && { label: 'Reply', icon: <Svg d={I.reply} size={15} />, run: () => onReply(ev) },
      !ev.status && onForward && { label: 'Forward…', icon: <Svg d={I.forward} size={15} />, run: () => onForward(ev) },
      onOpenThread && (replyId || replies?.length) && { label: 'View thread', icon: <Svg d={I.thread} size={15} />, run: () => onOpenThread(ev) },
      !ev.status && onSelectStart && { label: 'Select messages', icon: <Svg d={I.select} size={15} />, run: () => onSelectStart(ev) },
      'separator',
      sel && { label: 'Copy selection', icon: <Svg d={I.copy} size={15} />, run: () => navigator.clipboard.writeText(sel) },
      copyable && { label: 'Copy text', icon: <Svg d={I.copy} size={15} />, run: () => navigator.clipboard.writeText(stripReplyFallback(content.body || '')) },
      trBody && !ev.status && { label: 'Translate', icon: <Svg d={TRANSLATE_PATH} size={15} />, run: () => translateEvent(ev.getId(), trBody) },
      link && { label: 'Copy link', icon: <Svg d={I.copy} size={15} />, run: () => navigator.clipboard.writeText(link) },
      link && { label: 'Open link in browser', icon: <span>↗</span>, run: () => window.open(link, '_blank') },
      isImage && { label: 'Open image', icon: <span>🖼</span>, run: () => mediaEl()?.click() },
      isImage && { label: 'Copy image', icon: <Svg d={I.copy} size={15} />, run: () => { const u = mediaUrl(); if (u) copyImage(u).then(() => onToast?.('Image copied'), (err) => onToast?.(`Couldn’t copy: ${err.message}`)); } },
      !ev.status && remindersAvailable() && { label: 'Remind me about this…', icon: <Svg d={I.bell} size={15} />, run: () => askReminder(reminderTarget()) },
      seenBy && { label: 'Seen by…', icon: <Svg d="M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5Zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" size={15} />, run: () => setSeenOpen(seenBy()) },
      stickerItem(),
      (isMedia || isAudio || content.msgtype === MsgType.File) && { label: 'Save…', icon: <Svg d={I.download} size={15} />, run: saveMedia },
      !ev.status && onStar && { label: starred ? 'Unstar' : 'Star', icon: <Svg d={starred ? I.star : I.starOutline} size={15} />, run: () => onStar(ev) },
      canEdit && { label: 'Edit', icon: <Svg d={I.edit} size={15} />, run: () => onEdit(ev) },
      mine && 'separator',
      mine && { label: ev.status ? 'Cancel sending' : 'Delete for everyone', danger: true, icon: <Svg d={I.trash} size={15} />, run: () => onDelete(ev) },
    ]);
  };

  return (
    <div data-event-id={ev.getId()}
      className={`${className} msg ${mine ? 'mine' : 'theirs'} ${continued ? 'cont' : ''} ${ev.status ? 'pending' : ''} ${selecting ? 'selecting' : ''} ${selected ? 'selected' : ''}`}
      onClickCapture={selecting ? (e) => { e.preventDefault(); e.stopPropagation(); if (!ev.isRedacted() && !ev.status) onToggleSelect(ev); } : undefined}
      onDoubleClick={selecting ? undefined : onBlankClick}
      onWheel={onWheel}>
      {swipe > 0 && (
        <span className="swipe-reply" style={{ opacity: Math.min(1, swipe / SWIPE_AT), transform: `scale(${swipe >= SWIPE_AT ? 1.15 : 0.8 + 0.2 * (swipe / SWIPE_AT)})` }}>
          <Svg d={I.reply} size={16} />
        </span>
      )}
      {selecting && <span className={`msg-check ${selected ? 'on' : ''}`}>{selected ? '✓' : ''}</span>}
      {!mine && showSender && (
        <div className={`msg-avatar ${onOpenDirect ? 'clickable' : ''}`} title={onOpenDirect ? `Message ${sender} privately` : undefined}
          onClick={onOpenDirect && !continued ? (e) => { e.stopPropagation(); onOpenDirect(ev.getSender()); } : undefined}>
          {!continued && <Avatar src={avatar} name={sender} id={ev.getSender()} size={30} />}
        </div>
      )}
      <div className="msg-col" style={swipe ? { transform: `translateX(${mine ? -swipe : swipe}px)`, transition: 'none' } : undefined}>
        {!mine && showSender && !continued && (
          <div className={`msg-sender ${onOpenDirect ? 'clickable' : ''}`} style={{ color: nameColor(ev.getSender()) }}
            title={onOpenDirect ? `Message ${sender} privately` : undefined}
            onClick={onOpenDirect ? (e) => { e.stopPropagation(); onOpenDirect(ev.getSender()); } : undefined}>{sender}</div>
        )}
        <div className="msg-row">
          <div ref={bubbleRef} onContextMenu={onContextMenu} className={[
            'bubble',
            isMedia && 'media-bubble',
            isSticker && 'sticker-bubble',
            isAudio && 'audio-bubble',
            bigEmoji && 'big-emoji',
            ev.isRedacted() && 'redacted',
          ].filter(Boolean).join(' ')}>
            {replyId && <ReplyQuote room={room} id={replyId} onOpen={onOpenThread && !selecting ? () => onOpenThread(ev) : null} />}
            {linkOnly
              ? <LinkPreview client={client} room={room} url={link} ts={ev.getTs()} mine={mine} standalone />
              : !pixOnly && <Body client={client} room={room} ev={ev} content={shown} mine={mine} onOpenImage={onOpenImage} meta={meta} />}
            {previewLink && copyable && !linkOnly && !ev.isRedacted() && <LinkPreview client={client} room={room} url={link} ts={ev.getTs()} mine={mine} />}
            {smartOn && <SmartCards text={smartText} ts={ev.getTs()} mine={mine} ctx={{ roomName: cleanName(room.name || '') }} />}
            {content['dev.relay.view_once'] && <span className="vo-tag"><span className="vo-circle small">1</span>View once</span>}
            {!imageOverlay && !isAudio && meta}
          </div>

          {!ev.isRedacted() && !ev.status && !selecting && (
            <div className={`msg-tools ${picker ? 'open' : ''}`}>
              {QUICK_REACTIONS.map((k) => (
                <button key={k} className="emoji" onClick={() => onReact(ev, k)} title={`React ${k}`}>{k}</button>
              ))}
              <button onClick={() => setPicker(true)} title="More reactions"><Svg d={I.smile} /></button>
              <span className="tool-sep" />
              <button onClick={() => onReply(ev)} title="Reply"><Svg d={I.reply} /></button>
              {onForward && <button onClick={() => onForward(ev)} title="Forward"><Svg d={I.forward} /></button>}
              {onStar && <button onClick={() => onStar(ev)} title={starred ? 'Unstar' : 'Star'} className={starred ? 'starred' : ''}><Svg d={starred ? I.star : I.starOutline} /></button>}
              {copyable && <button onClick={() => navigator.clipboard.writeText(stripReplyFallback(content.body || ''))} title="Copy text"><Svg d={I.copy} /></button>}
              {canEdit && <button onClick={() => onEdit(ev)} title="Edit"><Svg d={I.edit} /></button>}
              {mine && <button onClick={() => onDelete(ev)} title="Delete for everyone" className="danger-tool"><Svg d={I.trash} /></button>}
              {picker && <EmojiPicker className="for-reaction" onPick={(e) => { setPicker(false); onReact(ev, e); }} onClose={() => setPicker(false)} />}
            </div>
          )}
        </div>

        {replies?.length > 0 && onOpenThread && !selecting && (
          <button className="reply-chip" onClick={(e) => { e.stopPropagation(); onOpenThread(ev); }} title="Show the thread">
            <span className="reply-faces">
              {[...new Set(replies.map((r) => r.getSender()))].slice(0, 3).map((u) => (
                <Avatar key={u} src={memberAvatar(client, room, u, 32)} name={senderName(room, u)} id={u} size={16} />
              ))}
            </span>
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </button>
        )}
        {!ev.status && <ReminderChip roomId={room.roomId} eventId={ev.getId()} roomName={cleanName(room.name || '')} sender={mine ? 'You' : sender}
          text={copyable ? stripReplyFallback(content.body || '') : undefined} />}
        {(trBody || (mine && content['dev.relay.original'])) && !selecting && <MessageTranslation ev={ev} body={trBody} mine={mine} />}
        {isAudio && !ev.isRedacted() && <Transcribe client={client} ev={ev} content={content} mine={mine} />}

        {reactions.length > 0 && (
          <div className="reactions">
            {reactions.map((r) => (
              <button
                key={r.key}
                className={r.mine ? 'mine' : ''}
                onClick={() => onReact(ev, r.key)}
                title={r.senders.map((s) => senderName(room, s)).join(', ')}
              >
                {r.key} {r.count > 1 && <span>{r.count}</span>}
              </button>
            ))}
          </div>
        )}

        {menuEl}
        {statusLine?.short && !failed && (
          statusLine.readers?.length ? (
            <button className="msg-status seen seen-by" onClick={() => setSeenOpen(seenOpen ? null : statusLine.readers)}>
              <span className="seen-faces">
                {statusLine.readers.slice(0, 4).map((r) => <Avatar key={r.userId} src={r.avatar} name={r.name} id={r.userId} size={16} />)}
              </span>
              {statusLine.short}
            </button>
          ) : <div className="msg-status seen">{statusLine.short}</div>
        )}
        {seenOpen && <SeenList readers={seenOpen} onClose={() => setSeenOpen(null)} />}
        {failed && (
          <div className="msg-status failed">
            Not sent · <button onClick={() => onRetry(ev)}>Retry</button> · <button onClick={() => onDelete(ev)}>Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Message;

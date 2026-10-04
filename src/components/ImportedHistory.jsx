// Old WhatsApp history imported from an iPhone backup or a .zip (electron/imports.cjs), shown at
// the top of the chat: a strip while collapsed, then pages of read-only bubbles older than the
// oldest message the bridge brought, with their photos, videos and audio loaded as they scroll in.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Lightbox from './Lightbox.jsx';
import { useImportFor, yearSpan, plural } from '../imports.js';

const api = () => window.relay.imports;
const PAGE = 150;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp', opus: 'audio/ogg', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', pdf: 'application/pdf' };
const KIND = { image: 'Photo', video: 'Video', audio: 'Voice message', sticker: 'Sticker', file: 'File', contact: 'Contact', location: 'Location' };
const Svg = ({ d, size = 16 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
const HISTORY = 'M13 3a9 9 0 0 0-9 9H1l3.9 3.9.1.1L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3Zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8H12Z';
const FILE = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm4 18H6V4h7v5h5v11Z';

const urls = new Map(); // rel path → blob url (kept for the session)
function useMediaUrl(rel, wanted) {
  const [url, setUrl] = useState(() => urls.get(rel) || null);
  useEffect(() => {
    if (!rel || !wanted) return undefined;
    if (urls.has(rel)) { setUrl(urls.get(rel)); return undefined; }
    let alive = true;
    api().media(rel).then((buf) => {
      const u = URL.createObjectURL(new Blob([buf], { type: MIME[rel.split('.').pop().toLowerCase()] || 'application/octet-stream' }));
      urls.set(rel, u);
      if (alive) setUrl(u);
    }).catch(() => {});
    return () => { alive = false; };
  }, [rel, wanted]);
  return url;
}

function Media({ m, onOpen }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const url = useMediaUrl(m.media, seen);
  const name = m.media?.split('/').pop();
  if (!m.media) return <span className="imh-missing"><Svg d={FILE} size={14} />{KIND[m.type] || 'Media'} (not included)</span>;
  return (
    <span ref={ref} className={`imh-media ${m.type}`}>
      {(m.type === 'image' || m.type === 'sticker') && (url ? <img src={url} alt="" onClick={() => m.type === 'image' && onOpen(url, name)} /> : <span className="imh-ph" />)}
      {m.type === 'video' && (url ? <video src={url} controls preload="metadata" /> : <span className="imh-ph" />)}
      {m.type === 'audio' && (url ? <audio src={url} controls preload="none" /> : <span className="imh-ph small" />)}
      {(m.type === 'file' || m.type === 'contact' || m.type === 'location') && <a href={url || undefined} download={name} className="imh-file"><Svg d={FILE} size={18} /><span>{name}</span></a>}
    </span>
  );
}

const hhmm = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayLabel = (ts) => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

export default function ImportedHistory({ room, group, scrollRef, cutoff }) {
  const imp = useImportFor(room.roomId);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [viewer, setViewer] = useState(null);
  const listRef = useRef(null);
  const anchor = useRef(null); // the first bubble and where it was, to keep the view still while prepending

  const load = async (before) => {
    setLoading(true);
    const r = await api().page({ key: imp.key, before, limit: PAGE });
    const first = listRef.current?.querySelector('[data-imh]');
    anchor.current = first ? { el: first, top: first.getBoundingClientRect().top } : null;
    setMsgs((cur) => [...r.messages, ...cur]);
    setMore(r.more);
    setLoading(false);
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchor.current;
    anchor.current = null;
    if (el && a?.el.isConnected) el.scrollTop += a.el.getBoundingClientRect().top - a.top;
  }, [msgs, scrollRef]);
  useEffect(() => { setMsgs([]); setOpen(false); }, [imp?.key]);

  if (!imp) return null;
  if (!open) {
    return (
      <button className="imh-strip" onClick={() => { setOpen(true); setMsgs([]); load(cutoff || undefined); }}>
        <span className="imh-ico"><Svg d={HISTORY} size={15} /></span>
        <span className="imh-label"><b>Imported history</b><small>{yearSpan(imp)} · {plural(imp.count, 'message')}</small></span>
        <span className="imh-cta">Show</span>
      </button>
    );
  }

  let lastDay = null;
  return (
    <div className="imh" ref={listRef}>
      {more ? (
        <button className="imh-more" disabled={loading} onClick={() => load(msgs[0]?.ts)}>{loading ? 'Loading…' : 'Load older messages'}</button>
      ) : !loading && (
        <div className="imh-begin">Beginning of the imported history ({imp.source === 'zip' ? 'chat export' : 'iPhone backup'})</div>
      )}
      {msgs.map((m, i) => {
        const d = new Date(m.ts).toDateString();
        const sep = d !== lastDay;
        lastDay = d;
        const prev = msgs[i - 1];
        const cont = !sep && prev && prev.me === m.me && prev.name === m.name;
        const showName = (imp.group ?? group) && !m.me && !cont;
        return (
          <div key={m.id} data-imh="">
            {sep && <div className="imh-day"><span>{dayLabel(m.ts)}</span></div>}
            <div className={`imh-msg ${m.me ? 'mine' : 'theirs'} ${cont ? 'cont' : ''}`}>
              <div className={`imh-bubble ${m.type === 'sticker' && !m.text ? 'bare' : ''}`}>
                {showName && <span className="imh-name">{m.name}</span>}
                {m.type !== 'text' && <Media m={m} onOpen={(src, name) => setViewer({ src, name })} />}
                {m.text && <span className="imh-text">{m.text}</span>}
                <span className="imh-time">{hhmm(m.ts)}</span>
              </div>
            </div>
          </div>
        );
      })}
      <div className="imh-end"><span>End of the imported history · newer messages come from WhatsApp</span><button onClick={() => setOpen(false)}>Hide</button></div>
      {viewer && createPortal(<Lightbox src={viewer.src} name={viewer.name} onClose={() => setViewer(null)} />, document.body)}
    </div>
  );
}

// WhatsApp sections of the details panel: contact profile, group admin, disappearing messages
// and the Media / Links / Docs tabs. See src/whatsapp-power.js for what the bridge supports.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EventType, KnownMembership, MsgType } from 'matrix-js-sdk';
import Avatar from './Avatar.jsx';
import { useMedia } from '../media.js';
import {
  roomAvatar, memberAvatar, senderName, cleanName, effectiveContent, isDisplayable, formatBytes, lastMessage,
} from '../matrix.js';
import {
  waKind, dmPartner, ghostPhone, formatPhone, waPower, probePower, participantError,
  userLevel, canSendState, groupSettings, TIMERS, roomTimer, setRoomTimer, timerLabel, TIMER_EVENT,
} from '../whatsapp-power.js';
import { TimerIcon } from './WaChatBits.jsx';

const BOT = /^@[a-z]+bot:/;
const URL_RE = /https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g;

const P = {
  phone: 'M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8Z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z',
  quote: 'M6 17h3l2-4V7H5v6h3l-2 4Zm8 0h3l2-4V7h-6v6h3l-2 4Z',
  block: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM4 12a8 8 0 0 1 12.9-6.3L5.7 16.9A7.95 7.95 0 0 1 4 12Zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.3 7.1A7.95 7.95 0 0 1 20 12a8 8 0 0 1-8 8Z',
  addPerson: 'M15 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6Zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z',
  link: 'M3.9 12A3.1 3.1 0 0 1 7 8.9h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12ZM8 13h8v-2H8v2Zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10Z',
  more: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  shield: 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm-2 16-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8Z',
  shieldOff: 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8Z',
  remove: 'M15 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-11-2v2h8v-2H4Zm11 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z',
  chat: 'M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z',
  camera: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM9 2 7.17 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3.17L15 2H9Z',
  megaphone: 'M18 11v2h4v-2h-4Zm-2 6.61c.96.71 2.21 1.65 3.2 2.39.4-.53.8-1.07 1.2-1.6-.99-.74-2.24-1.68-3.2-2.4-.4.54-.8 1.08-1.2 1.61ZM20.4 5.6c-.4-.53-.8-1.07-1.2-1.6-.99.74-2.24 1.68-3.2 2.4.4.53.8 1.07 1.2 1.6.96-.72 2.21-1.65 3.2-2.4ZM4 9a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1v4h2v-4h1l5 3V6L8 9H4Zm11.5 3c0-1.33-.58-2.53-1.5-3.35v6.69c.92-.81 1.5-2.01 1.5-3.34Z',
  pencil: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z',
  refresh: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z',
};

function Svg({ d, size = 18 }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
}

function Section({ title, action, children, className = '' }) {
  return (
    <section className={`ip-section ${className}`}>
      <div className="ip-head"><span>{title}</span>{action}</div>
      <div className="ip-card">{children}</div>
    </section>
  );
}

const day = (ts) => new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

/** null while checking, then whether the patched bridge (`sync relay`) is available. */
function usePower() {
  const [power, setPower] = useState(null);
  useEffect(() => {
    let alive = true;
    probePower().then((v) => alive && setPower(v));
    return () => { alive = false; };
  }, []);
  return power;
}

function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(0);
  const show = (text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3200);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const el = toast && createPortal(<div className={`wa-toast ${toast.kind}`} role="status">{toast.text}</div>, document.body);
  return [el, show];
}

// ---------- Disappearing messages ----------

export function DisappearingPicker({ client, room, kind }) {
  const me = client.getUserId();
  const current = roomTimer(room);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const allowed = canSendState(room, me, TIMER_EVENT);
  useEffect(() => { if (pending !== null && pending === current) setPending(null); }, [current, pending]);
  const shown = pending ?? current;
  const pick = async (ms) => {
    if (ms === shown || !allowed) return;
    setPending(ms);
    setError(null);
    try { await setRoomTimer(client, room.roomId, ms); }
    catch (err) { setPending(null); setError(`Couldn’t change it: ${err.message}`); }
  };
  return (
    <Section title="Disappearing messages" className="wa-timer-section">
      <div className="wa-timer">
        <div className="wa-timer-top">
          <span className={`wa-timer-ico ${shown ? 'on' : ''}`}><TimerIcon size={18} /></span>
          <span className="wa-timer-text">
            <b>{shown ? timerLabel(shown) : 'Off'}</b>
            <small>{shown
              ? `New messages disappear for everyone in this chat ${timerLabel(shown)} after they’re sent.`
              : 'Messages stay in the chat until someone deletes them.'}</small>
          </span>
        </div>
        <div className="wa-seg" role="radiogroup" aria-label="Disappearing messages duration">
          {TIMERS.map((t) => (
            <button key={t.ms} role="radio" aria-checked={shown === t.ms} className={shown === t.ms ? 'on' : ''}
              disabled={!allowed} onClick={() => pick(t.ms)}>
              {pending === t.ms && pending !== current ? <span className="spinner small" /> : t.label}
            </button>
          ))}
        </div>
        {!allowed && <small className="wa-note">{kind === 'group' ? 'Only admins can change this in this group.' : 'You can’t change this in this chat.'}</small>}
        {error && <small className="wa-note err">{error}</small>}
      </div>
    </Section>
  );
}

// ---------- Media / Links / Docs ----------

function collect(room) {
  const media = [];
  const links = [];
  const docs = [];
  const evs = room.getLiveTimeline().getEvents().filter(isDisplayable);
  for (let i = evs.length - 1; i >= 0; i--) {
    const ev = evs[i];
    if (ev.isRedacted() || ev.isDecryptionFailure?.()) continue;
    const c = effectiveContent(ev);
    if (c.msgtype === MsgType.Image || ev.getType() === EventType.Sticker) media.push({ kind: 'image', ev, content: c });
    else if (c.msgtype === MsgType.Video) media.push({ kind: 'video', ev, content: c });
    else if (c.msgtype === MsgType.File || (c.msgtype === MsgType.Audio && !c['org.matrix.msc3245.voice'])) docs.push({ ev, content: c });
    else if (c.msgtype === MsgType.Text || c.msgtype === MsgType.Notice) {
      const found = (c.body || '').match(URL_RE);
      for (const url of [...new Set(found || [])]) links.push({ ev, url });
    }
  }
  return { media, links, docs };
}

function MediaThumb({ client, room, item, onOpenImage }) {
  const thumb = useMedia(client, item.content, { thumb: true });
  const full = useMedia(client, item.content);
  const src = thumb.url || (item.kind === 'image' ? full.url : null);
  const sender = item.ev.getSender();
  return (
    <button className="wa-mtile" title={`${senderName(room, sender)} · ${day(item.ev.getTs())}`}
      onClick={() => full.url && (item.kind === 'image'
        ? onOpenImage?.({ src: full.url, name: item.content.filename || item.content.body, eventId: item.ev.getId() })
        : window.open(full.url, '_blank'))}>
      {src ? <img src={src} alt="" draggable={false} loading="lazy" /> : <span className="wa-mtile-ph" />}
      {item.kind === 'video' && <span className="wa-mtile-play">▶</span>}
    </button>
  );
}

function DocRow({ client, room, item }) {
  const { url } = useMedia(client, item.content);
  const name = item.content.filename || item.content.body || 'file';
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] || item.content.info?.mimetype?.split('/')[1] || 'doc').slice(0, 4).toUpperCase();
  return (
    <a className="wa-doc" href={url || undefined} download={name} onClick={(e) => { if (!url) e.preventDefault(); }}>
      <span className="wa-doc-ext" data-ext={ext}>{ext}</span>
      <span className="wa-doc-text">
        <span className="wa-doc-name">{name}</span>
        <small>{[formatBytes(item.content.info?.size), senderName(room, item.ev.getSender()), day(item.ev.getTs())].filter(Boolean).join(' · ')}</small>
      </span>
    </a>
  );
}

function LinkRow({ room, item }) {
  let host = item.url;
  try { host = new URL(item.url).hostname.replace(/^www\./, ''); } catch { /* keep the URL */ }
  return (
    <a className="wa-link" href={item.url} target="_blank" rel="noreferrer" title={item.url}>
      <span className="wa-link-fav">{host[0]?.toUpperCase()}</span>
      <span className="wa-doc-text">
        <span className="wa-doc-name">{host}</span>
        <small className="wa-link-url">{item.url.replace(/^https?:\/\/(www\.)?/, '')}</small>
        <small>{senderName(room, item.ev.getSender())} · {day(item.ev.getTs())}</small>
      </span>
    </a>
  );
}

export function MediaTabs({ client, room, onOpenImage, tick }) {
  const [tab, setTab] = useState('media');
  const [loading, setLoading] = useState(false);
  const [atStart, setAtStart] = useState(false);
  const [limit, setLimit] = useState(9);
  const data = useMemo(() => collect(room), [room, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = tab === 'media' ? data.media : tab === 'links' ? data.links : data.docs;
  const more = async () => {
    setLoading(true);
    try {
      const hasMore = await client.paginateEventTimeline(room.getLiveTimeline(), { backwards: true, limit: 150 });
      if (!hasMore) setAtStart(true);
    } catch { /* offline: try again later */ }
    setLoading(false);
  };
  const shown = list.slice(0, limit);
  const TABS = [['media', 'Media', data.media.length], ['links', 'Links', data.links.length], ['docs', 'Docs', data.docs.length]];
  return (
    <Section title="Media, links and docs" className="wa-media-section">
      <div className="wa-tabs" role="tablist">
        {TABS.map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => { setTab(id); setLimit(9); }}>
            {label}{n > 0 && <span className="wa-tab-n">{n}</span>}
          </button>
        ))}
      </div>
      {shown.length ? (
        tab === 'media' ? (
          <div className="wa-mgrid">
            {shown.map((m) => <MediaThumb key={m.ev.getId()} client={client} room={room} item={m} onOpenImage={onOpenImage} />)}
          </div>
        ) : (
          <div className="wa-rows">
            {shown.map((m, i) => (tab === 'links'
              ? <LinkRow key={`${m.ev.getId()}-${i}`} room={room} item={m} />
              : <DocRow key={m.ev.getId()} client={client} room={room} item={m} />))}
          </div>
        )
      ) : (
        <div className="ip-empty">{{ media: 'No photos or videos', links: 'No links', docs: 'No documents' }[tab]} in the loaded messages.</div>
      )}
      <div className="wa-tab-foot">
        {list.length > limit && <button className="ip-more" onClick={() => setLimit(limit + 24)}>Show more ({list.length - limit})</button>}
        {list.length <= limit && !atStart && (
          <button className="ip-more" disabled={loading} onClick={more}>{loading ? 'Searching…' : 'Search older messages'}</button>
        )}
      </div>
    </Section>
  );
}

// ---------- Contact profile (1:1 chats) ----------

/** WhatsApp groups where this person is also a member; loads member lists in the background. */
function useCommonGroups(client, ids) {
  const [, bump] = useState(0);
  const key = ids.join('|');
  useEffect(() => {
    if (!ids.length) return undefined;
    let cancelled = false;
    const groups = client.getRooms()
      .filter((r) => r.getMyMembership() === KnownMembership.Join && waKind(r) === 'group')
      .sort((a, b) => (lastMessage(b)?.getTs() || 0) - (lastMessage(a)?.getTs() || 0))
      .slice(0, 150);
    (async () => {
      for (let i = 0; i < groups.length && !cancelled; i += 4) {
        await Promise.all(groups.slice(i, i + 4).map((r) => r.loadMembersIfNeeded().catch(() => {})));
        if (!cancelled) bump((n) => n + 1);
      }
    })();
    return () => { cancelled = true; };
  }, [client, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return client.getRooms()
    .filter((r) => r.getMyMembership() === KnownMembership.Join && waKind(r) === 'group')
    .filter((r) => ids.some((id) => r.getMember(id)?.membership === KnownMembership.Join))
    .sort((a, b) => (lastMessage(b)?.getTs() || 0) - (lastMessage(a)?.getTs() || 0));
}

export function ContactProfile({ client, room, info, onOpenImage, onOpenRoom }) {
  const me = client.getUserId();
  const partner = dmPartner(room, me);
  const power = usePower();
  const [about, setAbout] = useState({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const [toastEl, toast] = useToast();

  useEffect(() => {
    let alive = true;
    if (power === false) setAbout({ state: 'off' });
    if (power !== true) return undefined;
    setAbout({ state: 'loading' });
    waPower('user-info', room.roomId).then((res) => {
      if (alive) setAbout(res.ok ? { state: 'ok', ...res } : { state: res.unsupported ? 'off' : 'error', error: res.error });
    });
    return () => { alive = false; };
  }, [room.roomId, power]);

  const phone = about.phone || ghostPhone(partner);
  const server = partner?.split(':').slice(1).join(':');
  const ids = [partner, phone && server ? `@whatsapp_${phone}:${server}` : null].filter(Boolean);
  const common = useCommonGroups(client, [...new Set(ids)]);
  const photo = roomAvatar(client, room, null);
  const name = info.name;

  const toggleBlock = async () => {
    if (!about.blocked && !window.confirm(`Block ${name}?\n\nBlocked contacts can’t call you or send you messages on WhatsApp. They aren’t notified.`)) return;
    setBusy(true);
    const res = await waPower('block', room.roomId, about.blocked ? 'unblock' : 'block');
    setBusy(false);
    if (res.ok) {
      setAbout((a) => ({ ...a, blocked: !!res.blocked }));
      toast(res.blocked ? `${name} is blocked` : `${name} is unblocked`);
    } else toast(`Couldn’t do that: ${res.error || 'unknown error'}`, 'err');
  };

  return (
    <>
      <div className="wa-hero">
        <button className="wa-hero-photo" disabled={!photo} title={photo ? 'View photo' : undefined}
          onClick={() => photo && onOpenImage?.({ src: photo, name })}>
          <Avatar src={roomAvatar(client, room, 320)} name={name} id={room.roomId} size={112} />
        </button>
        <h2>{name}</h2>
        {about.business_name && about.business_name !== name && <div className="wa-biz">✓ {about.business_name}</div>}
        {phone && (
          <button className="wa-phone" title="Copy number" onClick={() => { navigator.clipboard.writeText(`+${phone}`); toast('Number copied'); }}>
            <Svg d={P.phone} size={14} />{formatPhone(phone)}<span className="wa-copy"><Svg d={P.copy} size={12} /></span>
          </button>
        )}
        <div className="ip-account">{info.account?.business ? 'WhatsApp Business' : 'WhatsApp'}{info.account ? ` · on ${info.account.detail || info.account.name}` : ''}</div>
      </div>

      {about.state !== 'off' && (
        <Section title="About">
          <div className="wa-about">
            <span className="wa-about-ico"><Svg d={P.quote} size={16} /></span>
            {about.state === 'loading' ? (
              <span className="wa-skel"><i /><i /></span>
            ) : about.state === 'error' ? (
              <span className="muted small">Couldn’t load their about.</span>
            ) : about.about ? (
              <span className="wa-about-text">{about.about}</span>
            ) : (
              <span className="muted small">{name.split(' ')[0]} has no about, or only shares it with their contacts.</span>
            )}
          </div>
        </Section>
      )}

      <Section title={`Groups in common${common.length ? ` · ${common.length}` : ''}`}>
        {common.length ? common.slice(0, 12).map((g) => (
          <button key={g.roomId} className="ip-member clickable wa-common" onClick={() => onOpenRoom?.(g.roomId)}>
            <Avatar src={roomAvatar(client, g, 64)} name={cleanName(g.name)} id={g.roomId} size={34} />
            <span className="ip-member-text">
              <span>{cleanName(g.name)}</span>
              <span className="muted small">{g.getJoinedMemberCount()} members</span>
            </span>
          </button>
        )) : <div className="ip-empty">No groups in common found.</div>}
        {common.length > 12 && <div className="ip-empty small">and {common.length - 12} more</div>}
      </Section>

      {about.state === 'ok' && (
        <div className="wa-danger-zone">
          <button className={`wa-danger-row ${about.blocked ? 'undo' : ''}`} onClick={toggleBlock} disabled={busy}>
            <Svg d={P.block} size={18} />
            <span>{about.blocked ? `Unblock ${name}` : `Block ${name}`}</span>
            {busy && <span className="spinner small" />}
          </button>
        </div>
      )}
      {toastEl}
    </>
  );
}

// ---------- Group admin ----------

/** Camera button over the group photo, for people allowed to change it (bridge: SetGroupPhoto). */
export function GroupPhotoButton({ client, room }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  if (!canSendState(room, client.getUserId(), 'm.room.avatar')) return null;
  const pick = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const { content_uri: url } = await client.uploadContent(file, { name: file.name, type: file.type });
      await client.sendStateEvent(room.roomId, 'm.room.avatar', { url, info: { mimetype: file.type, size: file.size } }, '');
    } catch (err) {
      window.alert(`Couldn’t change the photo: ${err.message}`);
    }
    setBusy(false);
  };
  return (
    <>
      <button className="wa-photo-edit" title="Change group photo" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <span className="spinner small" /> : <Svg d={P.camera} size={16} />}
      </button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
    </>
  );
}

/** WhatsApp contacts you have 1:1 chats with, as their bridge ghosts. */
function useWaContacts(client, exclude) {
  return useMemo(() => {
    const me = client.getUserId();
    const seen = new Map();
    for (const r of client.getRooms()) {
      if (r.getMyMembership() !== KnownMembership.Join || waKind(r) !== 'dm') continue;
      const id = dmPartner(r, me);
      if (!id || !id.startsWith('@whatsapp_') || exclude.has(id) || seen.has(id)) continue;
      seen.set(id, { id, room: r, name: cleanName(r.name || senderName(r, id)), ts: lastMessage(r)?.getTs() || 0 });
    }
    return [...seen.values()].sort((a, b) => b.ts - a.ts);
  }, [client, exclude]);
}

function AddPeopleDialog({ client, room, members, power, onClose, onDone }) {
  const exclude = useMemo(() => new Set(members.map((m) => m.userId)), [members]);
  const contacts = useWaContacts(client, exclude);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState(null);
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose, busy]);
  const query = q.trim().toLowerCase();
  const digits = query.replace(/\D/g, '');
  const shown = contacts.filter((c) => !query || c.name.toLowerCase().includes(query) || (digits.length >= 3 && (ghostPhone(c.id) || '').includes(digits)));
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const add = async () => {
    setBusy(true);
    setErrors(null);
    const ids = [...picked];
    let res = power ? await waPower('participants', room.roomId, 'add', ...ids) : { unsupported: true };
    if (res.unsupported) {
      // Unpatched bridge: a Matrix invite is turned into a WhatsApp "add" (HandleMatrixMembership).
      const failed = new Map();
      for (const id of ids) { try { await client.invite(room.roomId, id); } catch (err) { failed.set(id, err.message); } }
      res = { ok: true, results: ids.map((id) => ({ mxid: id, error: failed.has(id) ? -1 : 0, msg: failed.get(id) })) };
    }
    setBusy(false);
    if (!res.ok) { setErrors([{ name: 'WhatsApp', msg: res.error }]); return; }
    const bad = (res.results || []).filter((r) => r.error).map((r) => ({
      name: contacts.find((c) => c.id === r.mxid)?.name || r.mxid,
      msg: r.msg || participantError(r.error, r.invite),
    }));
    const okCount = (res.results || []).length - bad.length;
    if (bad.length) setErrors(bad);
    else onDone(okCount);
  };

  return createPortal(
    <div className="overlay wa-overlay" onMouseDown={() => !busy && onClose()}>
      <div className="dialog wa-dialog wa-add" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div className="wa-title">
            <span className="wa-title-icon"><Svg d={P.addPerson} size={18} /></span>
            <div><h2>Add members</h2><p className="wa-sub">{cleanName(room.name)}</p></div>
          </div>
          <button className="wa-x" onClick={onClose} title="Close (Esc)">✕</button>
        </header>
        {picked.size > 0 && (
          <div className="wa-chips">
            {[...picked].map((id) => {
              const c = contacts.find((x) => x.id === id);
              return (
                <button key={id} className="wa-chip" onClick={() => toggle(id)} title="Remove">
                  <Avatar src={c ? roomAvatar(client, c.room, 40) : null} name={c?.name || id} id={id} size={20} />
                  {c?.name.split(' ')[0] || id}<span>✕</span>
                </button>
              );
            })}
          </div>
        )}
        <input className="fw-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search WhatsApp contacts" />
        <div className="fw-list wa-pick-list">
          {shown.map((c) => (
            <button key={c.id} className={`fw-row ${picked.has(c.id) ? 'on' : ''}`} onClick={() => toggle(c.id)}>
              <Avatar src={roomAvatar(client, c.room, 64)} name={c.name} id={c.id} size={34} />
              <span className="fw-name">{c.name}{ghostPhone(c.id) && <span className="muted small">{formatPhone(ghostPhone(c.id))}</span>}</span>
              <span className={`sel-check static ${picked.has(c.id) ? 'on' : ''}`}>{picked.has(c.id) ? '✓' : ''}</span>
            </button>
          ))}
          {!shown.length && <div className="ip-empty">{contacts.length ? 'No contacts found.' : 'Everyone you chat with on WhatsApp is already in this group.'}</div>}
        </div>
        {errors && (
          <div className="wa-errors">
            {errors.map((e, i) => <div key={i}><b>{e.name}:</b> {e.msg}</div>)}
          </div>
        )}
        <div className="wa-foot">
          <span className="muted small wa-foot-note">{picked.size ? `${picked.size} selected` : 'Pick who to add'}</span>
          <button className="wa-btn accent" disabled={!picked.size || busy} onClick={add}>{busy ? 'Adding…' : 'Add'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MemberMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [onClose]);
  const left = Math.max(8, Math.min(x, window.innerWidth - 248));
  const top = Math.min(y, window.innerHeight - 40 * items.length - 20);
  return createPortal(
    <div ref={ref} className="menu wa-member-menu" style={{ left, top }}>
      {items.map((it) => (
        <button key={it.label} className={it.destructive ? 'wa-destructive' : ''} onClick={() => { onClose(); it.run(); }}>
          <span className="menu-icon"><Svg d={it.icon} size={16} /></span>{it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

function Toggle({ on, busy, disabled, title, sub, icon, onChange }) {
  return (
    <button className={`wa-toggle-row ${on ? 'on' : ''}`} role="switch" aria-checked={on} disabled={disabled || busy} onClick={() => onChange(!on)}>
      <span className="wa-row-ico"><Svg d={icon} size={17} /></span>
      <span className="wa-toggle-text"><b>{title}</b><small>{sub}</small></span>
      {busy ? <span className="spinner small" /> : <span className="wa-switch"><i /></span>}
    </button>
  );
}

function InviteLink({ room, toast }) {
  const [state, setState] = useState({ link: null, loading: false, error: null });
  const load = async (reset) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const res = await waPower('invite-link', room.roomId, ...(reset ? ['reset'] : []));
    setState({ link: res.ok ? res.link : null, loading: false, error: res.ok ? null : res.error });
    if (res.ok && reset) toast('Link reset. The old link no longer works.');
  };
  const reset = () => {
    if (window.confirm('Reset the invite link?\n\nThe current link will stop working and nobody can join with it anymore. A new link is created.')) load(true);
  };
  const copy = () => { navigator.clipboard.writeText(state.link); toast('Link copied'); };
  return (
    <div className="wa-invite">
      {!state.link ? (
        <button className="wa-action-row" onClick={() => load(false)} disabled={state.loading}>
          <span className="wa-row-ico accent"><Svg d={P.link} size={17} /></span>
          <span className="wa-toggle-text"><b>Invite link</b><small>{state.error ? `Couldn’t get it: ${state.error}` : 'Anyone with the link can join the group'}</small></span>
          {state.loading && <span className="spinner small" />}
        </button>
      ) : (
        <div className="wa-invite-box">
          <div className="wa-invite-link" title={state.link}>
            <Svg d={P.link} size={15} /><span>{state.link.replace(/^https?:\/\//, '')}</span>
          </div>
          <div className="wa-invite-actions">
            <button onClick={copy}><Svg d={P.copy} size={15} />Copy</button>
            <button className="wa-destructive" onClick={reset} disabled={state.loading}>
              {state.loading ? <span className="spinner small" /> : <Svg d={P.refresh} size={15} />}Reset link
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function WaGroupAdmin({ client, room, info, actions, tick }) {
  const me = client.getUserId();
  const [all, setAll] = useState(false);
  const [menu, setMenu] = useState(null);
  const [busy, setBusy] = useState(null); // userId being changed
  const [adding, setAdding] = useState(false);
  const [settingBusy, setSettingBusy] = useState(null);
  const [optimistic, setOptimistic] = useState({}); // setting -> value until the bridge echoes it
  const [q, setQ] = useState('');
  const [toastEl, toast] = useToast();
  const power = usePower() === true;

  const members = useMemo(() => room.getJoinedMembers()
    .filter((m) => !BOT.test(m.userId))
    .sort((a, b) => (b.userId === me) - (a.userId === me) || (userLevel(room, b.userId) >= 50) - (userLevel(room, a.userId) >= 50) || a.name.localeCompare(b.name)),
  [room, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = Math.max(members.length, room.getJoinedMemberCount() - 1);
  const iAmAdmin = userLevel(room, me) >= 50;
  const settings = { ...groupSettings(room), ...optimistic };
  useEffect(() => {
    const real = groupSettings(room);
    setOptimistic((o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => real[k] !== v)));
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = q.trim().toLowerCase();
  const filtered = query ? members.filter((m) => senderName(room, m.userId).toLowerCase().includes(query) || (ghostPhone(m.userId) || '').includes(query)) : members;
  const shown = all || query ? filtered : filtered.slice(0, 10);

  const change = async (m, action) => {
    const name = senderName(room, m.userId);
    if (action === 'remove' && !window.confirm(`Remove ${name} from the group?\n\n${name} will stop getting messages from “${cleanName(room.name)}”.`)) return;
    if (action === 'demote' && !window.confirm(`Dismiss ${name} as admin?\n\n${name} stays in the group, without admin rights.`)) return;
    setBusy(m.userId);
    let res;
    if (power) res = await waPower('participants', room.roomId, action, m.userId);
    if ((!power || res?.unsupported) && action === 'remove') {
      // Unpatched bridge: a Matrix kick becomes a WhatsApp removal (HandleMatrixMembership).
      try { await client.kick(room.roomId, m.userId); res = { ok: true, results: [{ error: 0 }] }; }
      catch (err) { res = { ok: false, error: err.message }; }
    }
    setBusy(null);
    const err = !res?.ok ? res?.error : participantError(res.results?.[0]?.error);
    if (err) { toast(`Couldn’t do that: ${err}`, 'err'); return; }
    toast({ promote: `${name} is now an admin`, demote: `${name} is no longer an admin`, remove: `${name} was removed from the group` }[action]);
  };

  const setSetting = async (key, value) => {
    setSettingBusy(key);
    const res = await waPower('setting', room.roomId, key, value ? 'on' : 'off');
    setSettingBusy(null);
    if (res.ok) { setOptimistic((o) => ({ ...o, [key]: value })); toast('Group settings updated'); }
    else toast(`Couldn’t do that: ${res.error}`, 'err');
  };

  const openMenu = (e, m) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const level = userLevel(room, m.userId);
    const isAdmin = level >= 50;
    const first = senderName(room, m.userId).split(' ')[0];
    const items = [
      { label: `Message ${first}`, icon: P.chat, run: () => actions.openDirect(m.userId, info) },
      iAmAdmin && power && !isAdmin && { label: 'Make group admin', icon: P.shield, run: () => change(m, 'promote') },
      iAmAdmin && power && isAdmin && level < 75 && { label: 'Dismiss as admin', icon: P.shieldOff, run: () => change(m, 'demote') },
      iAmAdmin && level < 75 && { label: `Remove ${first}`, icon: P.remove, destructive: true, run: () => change(m, 'remove') },
    ].filter(Boolean);
    setMenu({ x: r.right - 240, y: r.bottom + 4, items });
  };

  return (
    <>
      <Section title={`Members · ${total}`} className="wa-members">
        {iAmAdmin && (
          <button className="wa-action-row" onClick={() => setAdding(true)}>
            <span className="wa-row-ico accent"><Svg d={P.addPerson} size={17} /></span>
            <span className="wa-toggle-text"><b>Add members</b><small>Pick from your WhatsApp contacts</small></span>
          </button>
        )}
        {iAmAdmin && power && <InviteLink room={room} toast={toast} />}
        {members.length > 10 && (
          <input className="wa-member-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${members.length} members`} />
        )}
        {shown.map((m) => {
          const lvl = userLevel(room, m.userId);
          const phone = ghostPhone(m.userId);
          const name = senderName(room, m.userId);
          return (
            <div key={m.userId} className={`ip-member wa-member ${m.userId !== me ? 'clickable' : ''}`}
              onClick={m.userId !== me ? (e) => openMenu(e, m) : undefined}>
              <Avatar src={memberAvatar(client, room, m.userId, 64)} name={name} id={m.userId} size={34} />
              <span className="ip-member-text">
                <span>{m.userId === me ? 'You' : name}</span>
                {phone && cleanName(`+${phone}`) !== name && <span className="muted small">{formatPhone(phone)}</span>}
              </span>
              {busy === m.userId ? <span className="spinner small" /> : lvl >= 50 && (
                <span className={`ip-badge wa-admin ${lvl >= 75 ? 'owner' : ''}`} title={lvl >= 75 ? 'Created the group' : 'Group admin'}>{lvl >= 75 ? 'Owner' : 'Admin'}</span>
              )}
              {m.userId !== me ? <button className="wa-more" title="Options" onClick={(e) => openMenu(e, m)}><Svg d={P.more} size={16} /></button> : <span className="wa-more-ph" />}
            </div>
          );
        })}
        {!query && members.length > 10 && (
          <button className="ip-more" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${members.length}`}</button>
        )}
        {query && !filtered.length && <div className="ip-empty">Nobody by that name.</div>}
      </Section>

      {iAmAdmin && power && (
        <Section title="Group permissions" className="wa-perms">
          <Toggle on={settings.announce} busy={settingBusy === 'announce'} icon={P.megaphone}
            title="Only admins can send messages"
            sub={settings.announce ? 'Other members can only read' : 'Everyone can send messages'}
            onChange={(v) => setSetting('announce', v)} />
          <Toggle on={settings.locked} busy={settingBusy === 'locked'} icon={P.pencil}
            title="Only admins can edit group info"
            sub={settings.locked ? 'Name, description, photo and disappearing messages' : 'Everyone can change the name, description and photo'}
            onChange={(v) => setSetting('locked', v)} />
        </Section>
      )}
      {!iAmAdmin && (settings.announce || settings.locked) && (
        <div className="wa-perm-note">
          <Svg d={P.shield} size={14} />
          {settings.announce ? 'Only admins can send messages in this group.' : 'Only admins can edit this group’s info.'}
        </div>
      )}

      {menu && <MemberMenu {...menu} onClose={() => setMenu(null)} />}
      {adding && <AddPeopleDialog client={client} room={room} members={members} power={power} onClose={() => setAdding(false)}
        onDone={(n) => { setAdding(false); toast(`${n} member${n > 1 ? 's' : ''} added`); }} />}
      {toastEl}
    </>
  );
}

/** Which WhatsApp chat (for InfoPanel): 'group' | 'dm' | null. */
export function waPanelKind(room, network) {
  const k = waKind(room, network);
  return k === 'group' || k === 'dm' ? k : null;
}

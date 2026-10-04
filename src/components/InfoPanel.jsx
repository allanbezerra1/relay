import { useEffect, useMemo, useRef, useState } from 'react';
import { EventType, MsgType } from 'matrix-js-sdk';
import Avatar from './Avatar.jsx';
import { ContactProfile, WaGroupAdmin, DisappearingPicker, MediaTabs, GroupPhotoButton, waPanelKind } from './WaPanels.jsx';
import { useMedia } from '../media.js';
import { networkInfo } from '../networks.js';
import {
  roomAvatar, memberAvatar, senderName, cleanName, peopleCount, effectiveContent,
  previewText, formatTime, isDisplayable,
} from '../matrix.js';
import {
  getLabels, roomLabels, createLabel, toggleLabel, getStarred, toggleStar, isMuted, setMuted,
} from '../chatmeta.js';

const BOT = /^@[a-z]+bot:/;
const URL_RE = /https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/;

const ICON = {
  bell: 'M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z',
  bellOff: 'M20 18.69 7.84 6.14 5.27 3.49 4 4.76l2.8 2.8v.01A6.96 6.96 0 0 0 6 11v5l-2 2v1h13.73l2 2L21 19.72l-1-1.03ZM12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm6-7.32V11a6.99 6.99 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16c-.47.1-.92.26-1.34.46L18 14.68Z',
  pin: 'M16 3v2h-1v5l2 3v2h-4v6l-1 1-1-1v-6H7v-2l2-3V5H8V3h8Z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z',
  archive: 'M20.54 5.23 19.15 3.55A1.45 1.45 0 0 0 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23A1.98 1.98 0 0 0 3 6.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.5c0-.48-.17-.93-.46-1.27ZM12 17.5 6.5 12H10v-2h4v2h3.5L12 17.5ZM5.12 5l.81-1h12l.94 1H5.12Z',
  unread: 'M20 6.54v10.91c0 .3-.24.55-.55.55H4.55A.55.55 0 0 1 4 17.45V6.55c0-.3.25-.55.55-.55h10.03a4 4 0 0 0 5.42.54ZM18 1a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  leave: 'M10.09 15.59 11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59ZM19 3H5a2 2 0 0 0-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z',
  star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27Z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z',
  link: 'M3.9 12A3.1 3.1 0 0 1 7 8.9h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12ZM8 13h8v-2H8v2Zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10Z',
};

function Svg({ d, size = 18 }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
}

/** Phone number from a bridge ghost ID like @whatsapp_5511987654321:server. */
function phoneOf(userId) {
  const m = /^@whatsapp_(\d{8,15}):/.exec(userId);
  return m ? cleanName(`+${m[1]}`) : null;
}

function MediaTile({ client, room, item, onOpenImage }) {
  const content = item.content;
  const thumb = useMedia(client, content, { thumb: true });
  const full = useMedia(client, content);
  const sender = item.ev.getSender();
  const src = thumb.url || full.url;
  return (
    <button className="media-tile" onClick={() => full.url && onOpenImage({ src: full.url, name: content.filename || content.body, eventId: item.ev.getId() })}>
      {src ? <img src={src} alt="" draggable={false} /> : <span className="media-loading" />}
      {item.kind === 'video' && <span className="tile-play">▶</span>}
      <span className="tile-avatar"><Avatar src={memberAvatar(client, room, sender, 48)} name={senderName(room, sender)} id={sender} size={22} /></span>
    </button>
  );
}

function LinkTile({ client, room, item }) {
  const sender = item.ev.getSender();
  let host = item.url;
  try { host = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  return (
    <a className="media-tile link" href={item.url} target="_blank" rel="noreferrer">
      <span className="tile-avatar"><Avatar src={memberAvatar(client, room, sender, 48)} name={senderName(room, sender)} id={sender} size={22} /></span>
      <span className="link-host">{host}</span>
      <span className="link-url"><Svg d={ICON.link} size={12} /> {item.url.replace(/^https?:\/\//, '')}</span>
    </a>
  );
}

function Section({ title, action, children }) {
  return (
    <section className="ip-section">
      <div className="ip-head"><span>{title}</span>{action}</div>
      <div className="ip-card">{children}</div>
    </section>
  );
}

export default function InfoPanel({ client, info, actions, onClose, onOpenImage, onJump, tick }) {
  const { room } = info;
  const me = client.getUserId();
  const net = networkInfo(info.network);
  const isGroup = peopleCount(room) > 2;
  // WhatsApp chats get the richer sections from WaPanels.jsx (contact profile, group admin, tabs).
  const wa = waPanelKind(room, info.baseNetwork || info.network);
  // Name / description are editable only when the room's power levels allow it (WhatsApp: "only admins edit info").
  const canEditInfo = isGroup && room.currentState.maySendStateEvent('m.room.name', me);
  const [allMembers, setAllMembers] = useState(false);
  const [allMedia, setAllMedia] = useState(false);
  const [labelMenu, setLabelMenu] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [editing, setEditing] = useState(null); // 'name' | 'topic'
  const [draft, setDraft] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const savedNote = room.getAccountData('dev.relay.notes')?.getContent()?.text || '';
  const [note, setNote] = useState(savedNote);
  useEffect(() => setNote(savedNote), [room.roomId]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveNote = () => { if (note !== savedNote) client.setRoomAccountData(room.roomId, 'dev.relay.notes', { text: note }).catch(() => {}); };
  const labelRef = useRef(null);

  useEffect(() => { room.loadMembersIfNeeded().catch(() => {}); }, [room]);
  useEffect(() => {
    if (!labelMenu) return;
    const close = (e) => { if (!labelRef.current?.contains(e.target)) setLabelMenu(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [labelMenu]);

  const topic = room.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic || '';
  const showTopic = topic && !topic.toLowerCase().includes(`${net.name.toLowerCase()} private chat`) && topic !== 'WhatsApp status updates from your contacts';
  const muted = isMuted(client, room.roomId);

  const members = useMemo(() => room.getJoinedMembers()
    .filter((m) => !BOT.test(m.userId))
    .sort((a, b) => (b.userId === me) - (a.userId === me) || a.name.localeCompare(b.name)),
  [room, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const memberTotal = Math.max(members.length, isGroup ? room.getJoinedMemberCount() - 1 : members.length);

  const media = useMemo(() => {
    const out = [];
    const evs = room.getLiveTimeline().getEvents().filter(isDisplayable);
    for (let i = evs.length - 1; i >= 0; i--) {
      const ev = evs[i];
      if (ev.isRedacted()) continue;
      const c = effectiveContent(ev);
      if (c.msgtype === MsgType.Image || ev.getType() === EventType.Sticker) out.push({ kind: 'image', ev, content: c });
      else if (c.msgtype === MsgType.Video) out.push({ kind: 'video', ev, content: c });
      else if (c.msgtype === MsgType.Text) {
        const url = URL_RE.exec(c.body || '')?.[0];
        if (url) out.push({ kind: 'link', ev, url });
      }
    }
    return out;
  }, [room, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const starred = getStarred(room).map((s) => ({ ...s, ev: room.findEventById(s.id) }));
  const labels = getLabels(client);
  const applied = roomLabels(room, labels);
  const canTimer = (info.baseNetwork || info.network).startsWith('whatsapp');

  const loadMoreMedia = async () => {
    setLoadingMore(true);
    try { await client.paginateEventTimeline(room.getLiveTimeline(), { backwards: true, limit: 100 }); }
    finally { setLoadingMore(false); }
  };

  const saveEdit = async () => {
    const value = draft.trim();
    try {
      if (editing === 'name' && value && value !== info.name) await client.setRoomName(room.roomId, value);
      if (editing === 'topic' && value !== topic) await client.setRoomTopic(room.roomId, value);
    } catch (err) {
      alert(`Couldn’t save: ${err.message}`);
    }
    setEditing(null);
  };

  const addNewLabel = async (e) => {
    e.preventDefault();
    if (!newLabel.trim()) return;
    const label = await createLabel(client, newLabel);
    await toggleLabel(client, room, label, true);
    setNewLabel('');
  };

  const shownMedia = allMedia ? media : media.slice(0, 6);
  const shownMembers = allMembers ? members : members.slice(0, 8);

  return (
    <aside className="info-panel">
      <div className="ip-top">
        <button className={`ip-icon ${muted ? 'on' : ''}`} title={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted(client, room.roomId, !muted)}>
          <Svg d={muted ? ICON.bellOff : ICON.bell} />
        </button>
        <button className={`ip-icon ${info.pinned ? 'on accent' : ''}`} title={info.pinned ? 'Unpin' : 'Pin'} onClick={() => actions.togglePin(info)}>
          <Svg d={ICON.pin} />
        </button>
        <span className="ip-spacer" />
        <button className="ip-icon" title="Close" onClick={onClose}><Svg d={ICON.close} /></button>
      </div>

      <div className="ip-scroll">
        {wa === 'dm' ? <ContactProfile client={client} room={room} info={info} onOpenImage={onOpenImage} onOpenRoom={actions.openRoom} /> : (
        <div className="ip-hero">
          <div className="wa-photo-wrap">
            <Avatar src={roomAvatar(client, room, 240)} name={info.name} id={room.roomId} size={104} />
            {wa === 'group' && <GroupPhotoButton client={client} room={room} />}
          </div>
          {editing === 'name' ? (
            <input className="ip-edit" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={saveEdit}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }} />
          ) : (
            <h2 className={canEditInfo ? 'editable' : ''} onClick={() => { if (canEditInfo) { setDraft(info.name); setEditing('name'); } }}>{info.name}</h2>
          )}
          <div className="ip-net"><span className="net-dot-sm" style={{ '--c': net.color }} />{info.account?.business ? 'WhatsApp Business' : net.name}{isGroup ? ` · ${memberTotal} members` : ''}</div>
          {info.account && <div className="ip-account">on {info.account.detail || info.account.name}</div>}
          {editing === 'topic' ? (
            <textarea className="ip-edit" autoFocus rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={saveEdit}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') setEditing(null); }} />
          ) : showTopic ? (
            <p className={`ip-topic ${canEditInfo ? 'editable' : ''}`} onClick={() => { if (canEditInfo) { setDraft(topic); setEditing('topic'); } }}>{topic}</p>
          ) : canEditInfo ? (
            <button className="ip-link" onClick={() => { setDraft(''); setEditing('topic'); }}>Add a description…</button>
          ) : null}
        </div>
        )}

        {wa === 'group' ? <WaGroupAdmin client={client} room={room} info={info} actions={actions} tick={tick} /> : wa === 'dm' ? null : (
        <Section title={isGroup ? `Members · ${memberTotal}` : 'Contact'}>
          {shownMembers.map((m) => (
            <div key={m.userId} className={`ip-member ${m.userId !== me && isGroup ? 'clickable' : ''}`}
              title={m.userId !== me && isGroup ? 'Message privately' : undefined}
              onClick={m.userId !== me && isGroup ? () => actions.openDirect(m.userId, info) : undefined}>
              <Avatar src={memberAvatar(client, room, m.userId, 64)} name={senderName(room, m.userId)} id={m.userId} size={34} />
              <span className="ip-member-text">
                <span>{m.userId === me ? 'You' : senderName(room, m.userId)}</span>
                {phoneOf(m.userId) && phoneOf(m.userId) !== senderName(room, m.userId) && <span className="muted small">{phoneOf(m.userId)}</span>}
              </span>
              {m.powerLevel >= 50 && m.userId !== me && <span className="ip-badge">Admin</span>}
            </div>
          ))}
          {members.length > 8 && (
            <button className="ip-more" onClick={() => setAllMembers(!allMembers)}>{allMembers ? 'Show less' : `Show all ${members.length}`}</button>
          )}
        </Section>
        )}

        {wa ? <MediaTabs client={client} room={room} onOpenImage={onOpenImage} tick={tick} /> : (
        <Section title="Media" action={media.length > 6 && <button className="ip-link" onClick={() => setAllMedia(!allMedia)}>{allMedia ? 'Show less' : 'Show all'}</button>}>
          {media.length ? (
            <div className="media-grid">
              {shownMedia.map((m) => (
                m.kind === 'link'
                  ? <LinkTile key={m.ev.getId()} client={client} room={room} item={m} />
                  : <MediaTile key={m.ev.getId()} client={client} room={room} item={m} onOpenImage={onOpenImage} />
              ))}
            </div>
          ) : <div className="ip-empty">No photos or links in the loaded messages.</div>}
          {(allMedia || !media.length) && (
            <button className="ip-more" disabled={loadingMore} onClick={loadMoreMedia}>{loadingMore ? 'Loading…' : 'Load older messages'}</button>
          )}
        </Section>
        )}

        <Section title="Starred">
          {starred.length ? starred.map((s) => (
            <button key={s.id} className="ip-star" onClick={() => onJump(s.id)}>
              <Svg d={ICON.star} size={14} />
              <span className="ip-star-text">
                <span>{s.ev ? previewText(room, s.ev, '').replace(/^[^:]+: /, '') : 'Message not loaded yet'}</span>
                <span className="muted small">{s.ev ? `${senderName(room, s.ev.getSender())} · ` : ''}{formatTime(s.ts)}</span>
              </span>
              <span className="ip-x" title="Unstar" onClick={(e) => { e.stopPropagation(); if (s.ev) toggleStar(client, room, s.ev); }}>✕</span>
            </button>
          )) : (
            <div className="ip-empty"><b>No starred messages</b><br />Hover a message and press ☆ to keep it here.</div>
          )}
        </Section>

        <Section title="Labels">
          <div className="ip-labels" ref={labelRef}>
            {applied.map((l) => (
              <span key={l.id} className="label-chip" style={{ '--c': l.color }}>
                {l.name}<button onClick={() => toggleLabel(client, room, l, false)}>✕</button>
              </span>
            ))}
            <button className="ip-add-label" onClick={() => setLabelMenu(!labelMenu)}><Svg d={ICON.plus} size={15} /> Add to a label</button>
            {labelMenu && (
              <div className="label-menu">
                {labels.map((l) => {
                  const on = applied.some((a) => a.id === l.id);
                  return (
                    <button key={l.id} onClick={() => toggleLabel(client, room, l, !on)}>
                      <span className="label-dot" style={{ background: l.color }} />{l.name}<span className="label-check">{on ? '✓' : ''}</span>
                    </button>
                  );
                })}
                <form onSubmit={addNewLabel}>
                  <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="New label (e.g. Work)" autoFocus />
                </form>
              </div>
            )}
          </div>
        </Section>

        {canTimer && <DisappearingPicker client={client} room={room} kind={wa || 'dm'} />}
        <Section title="Notes">
          <textarea className="ip-notes" value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote}
            placeholder="Private notes about this chat. Only you can see them." rows={4} />
        </Section>
      </div>

      <div className="ip-bottom">
        <button title={info.archived ? 'Move to inbox' : 'Archive'} onClick={() => actions.toggleArchive(info)}><Svg d={ICON.archive} /><span>{info.archived ? 'Unarchive' : 'Archive'}</span></button>
        <button title="Mark as unread" onClick={() => actions.markUnread(info)}><Svg d={ICON.unread} /><span>Unread</span></button>
        <button title={wa ? (wa === 'group' ? 'Exit group and delete the chat' : 'Delete chat') : 'Leave chat'} className="danger-tool" onClick={() => actions.leave(info)}>
          <Svg d={ICON.leave} /><span>{wa === 'dm' ? 'Delete' : 'Leave'}</span>
        </button>
      </div>
    </aside>
  );
}

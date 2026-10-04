import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Direction, EventStatus } from 'matrix-js-sdk';
import Avatar from './Avatar.jsx';
import Message from './Message.jsx';
import Composer from './Composer.jsx';
import Lightbox, { roomGallery } from './Lightbox.jsx';
import InfoPanel from './InfoPanel.jsx';
import ForwardDialog, { forwardContent } from './ForwardDialog.jsx';
import { isMuted, isStarred, toggleStar } from '../chatmeta.js';
import { useClientTick } from '../hooks.js';
import { uiSound, reactionSound } from '../sounds.js';
import { networkInfo } from '../networks.js';
import { replyToId, cleanName, peopleCount, isDisplayable, reactionsFor, roomAvatar, memberAvatar, senderName, formatDay } from '../matrix.js';
import { uploadAttachment } from '../media.js';
import { ask, notice } from '../dialogs.jsx';
import { ChatWallpaper } from './Wallpaper.jsx';
import { burstReaction, useLiveArrivals } from '../fx.js';

const GROUP_GAP_MS = 5 * 60 * 1000;
const MIN_EVENTS = 30;

export default function ChatView({ client, info, focused, actions, droppedFiles, onDroppedTaken }) {
  const { room } = info;
  const me = client.getUserId();
  const net = networkInfo(info.network);
  const isGroup = peopleCount(room) > 2;

  const scrollRef = useRef(null);
  useLiveArrivals(scrollRef, room.roomId);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [atStart, setAtStart] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  // Open the viewer on a photo, able to page through the chat's photos and videos.
  // Pages older history in until more photos/videos show up (or the chat's start is reached).
  const loadOlderMedia = async () => {
    const before = roomGallery(room).length;
    for (let i = 0; i < 6; i++) {
      const more = await client.paginateEventTimeline(room.getLiveTimeline(), { backwards: true, limit: 60 }).catch(() => false);
      const now = roomGallery(room);
      if (now.length > before) return now;
      if (!more) return null;
    }
    return roomGallery(room);
  };
  const openMedia = (x) => {
    const items = x?.eventId ? roomGallery(room) : [];
    const index = items.findIndex((it) => it.eventId === x?.eventId);
    setLightbox(index >= 0 ? { items, index, loadOlder: loadOlderMedia } : x);
  };
  // Message multi-select + forwarding
  const [msgSel, setMsgSel] = useState(null); // null = not selecting, else Set of event ids
  const [forwarding, setForwarding] = useState(null); // events to forward
  const [toast, setToast] = useState(null);
  // Thread focus: the question, the replies to it, and the replies to those.
  const [threadRoot, setThreadRoot] = useState(null);
  useEffect(() => {
    if (!threadRoot) return;
    const esc = (e) => { if (e.key === 'Escape') setThreadRoot(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [threadRoot]);
  const toggleMsg = (ev) => setMsgSel((s) => { const n = new Set(s || []); n.has(ev.getId()) ? n.delete(ev.getId()) : n.add(ev.getId()); return n; });
  const showToast = (text) => { setToast(text); setTimeout(() => setToast(null), 2500); };
  const [infoOpen, setInfoOpen] = useState(() => localStorage.getItem('relay.infoOpen') === '1');
  const tick = useClientTick(client);
  const toggleInfo = () => setInfoOpen((v) => { try { localStorage.setItem('relay.infoOpen', v ? '0' : '1'); } catch {} return !v; });

  // Scroll to a message (e.g. from Starred) and flash it.
  const jumpTo = (eventId) => {
    const el = scrollRef.current?.querySelector(`[data-event-id="${CSS.escape(eventId)}"]`);
    if (!el) { notice({ icon: 'info', title: 'Message not loaded', body: 'Scroll up to load older messages first.' }); return; }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  };
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState([]);
  const composerRef = useRef(null);

  const timeline = room.getLiveTimeline();
  const events = timeline.getEvents().filter(isDisplayable);

  // Who replied to what (within the loaded history).
  const byId = new Map(events.map((e) => [e.getId(), e]));
  const repliesTo = new Map();
  for (const e of events) {
    const target = replyToId(e);
    if (target) (repliesTo.get(target) || repliesTo.set(target, []).get(target)).push(e);
  }
  const threadEvents = (() => {
    if (!threadRoot) return [];
    let top = byId.get(threadRoot);
    const seen = new Set();
    while (top && replyToId(top) && byId.get(replyToId(top)) && !seen.has(top.getId())) { seen.add(top.getId()); top = byId.get(replyToId(top)); }
    if (!top) return [];
    const out = [top];
    for (let i = 0; i < out.length; i++) for (const r of repliesTo.get(out[i].getId()) || []) if (!out.includes(r)) out.push(r);
    return out.sort((a, b) => a.getTs() - b.getTs());
  })();

  // ----- Back-pagination -----
  const loadOlder = useCallback(async () => {
    if (loadingOlder || atStart) return;
    setLoadingOlder(true);
    try {
      const more = await client.paginateEventTimeline(room.getLiveTimeline(), { backwards: true, limit: 40 });
      if (!more) setAtStart(true);
    } catch (err) {
      console.warn('Pagination failed', err);
    } finally {
      setLoadingOlder(false);
    }
  }, [client, room, loadingOlder, atStart]);

  // Fill the screen on open.
  useEffect(() => {
    if (!atStart && !loadingOlder && events.length < MIN_EVENTS && room.getLiveTimeline().getPaginationToken(Direction.Backward)) {
      loadOlder();
    }
  }, [events.length, atStart, loadingOlder]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = scrollRef.current;
    // column-reverse: scrollTop is 0 at the bottom and negative going up.
    if (el && el.scrollHeight + el.scrollTop - el.clientHeight < 400) loadOlder();
  };

  // ----- Typing indicators: WhatsApp only sends them while this chat is open and we're "online" -----
  const isWhatsApp = /^whatsapp/.test(info.network || '');
  useEffect(() => {
    const viewing = window.relay.local?.viewing;
    if (!isWhatsApp || !viewing) return undefined;
    if (!focused) { viewing(room.roomId, false); return undefined; }
    viewing(room.roomId, true);
    const keepAlive = setInterval(() => viewing(room.roomId, true), 60 * 1000);
    return () => clearInterval(keepAlive);
  }, [room.roomId, focused, isWhatsApp]);

  // ----- Read receipts -----
  const lastEvent = timeline.getEvents().at(-1);
  useEffect(() => {
    if (focused) window.relay.clearNotifications?.(room.roomId); // you're looking at it now
    if (!focused || !lastEvent || lastEvent.status) return;
    if (room.hasUserReadEvent(me, lastEvent.getId()) && !info.unread && !info.markedUnread) return;
    client.sendReadReceipt(lastEvent, actions.receiptType()).catch(() => {});
    if (info.markedUnread) client.setRoomAccountData(room.roomId, 'm.marked_unread', { unread: false }).catch(() => {});
  }, [focused, lastEvent?.getId(), info.unread]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stay pinned to the newest message when we send something.
  useLayoutEffect(() => {
    if (lastEvent?.getSender() === me && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [lastEvent?.getId()]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- Sending -----
  const MAX_UPLOAD = 2000 * 1024 * 1024; // WhatsApp's limit, same as Beeper
  // Files wait in a tray above the composer (caption, remove, add more) until you hit send.
  const [staged, setStaged] = useState([]);
  const stageFiles = (files) => {
    const tooBig = files.filter((f) => f.size > MAX_UPLOAD);
    if (tooBig.length) notice({ title: tooBig.length > 1 ? 'Files too large' : 'File too large', body: `${tooBig.length > 1 ? 'They are' : 'It is'} over 2 GB, the most WhatsApp accepts.`, list: tooBig.map((f) => f.name) });
    const ok = files.filter((f) => f.size <= MAX_UPLOAD);
    setStaged((s) => [...s, ...ok.map((file) => ({
      id: Math.random().toString(36).slice(2),
      file,
      preview: /^(image|video)\//.test(file.type) ? URL.createObjectURL(file) : null,
    }))]);
    composerRef.current?.focus();
  };
  useEffect(() => {
    if (!droppedFiles) return;
    stageFiles(droppedFiles);
    onDroppedTaken?.();
  }, [droppedFiles]); // eslint-disable-line react-hooks/exhaustive-deps
  const unstage = (id) => setStaged((s) => {
    const item = s.find((x) => x.id === id);
    if (item?.preview) URL.revokeObjectURL(item.preview);
    return s.filter((x) => x.id !== id);
  });
  const clearStaged = () => setStaged((s) => { s.forEach((x) => x.preview && URL.revokeObjectURL(x.preview)); return []; });
  useEffect(() => clearStaged, [room.roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendStaged = async (caption, asDocument, replyTo, viewOnce = false) => {
    const items = staged;
    setStaged([]);
    await sendFiles(items.map((x) => x.file), caption, asDocument, replyTo, viewOnce);
    items.forEach((x) => x.preview && URL.revokeObjectURL(x.preview));
  };

  const sendFiles = async (files, caption = '', asDocument = false, replyTo = null, viewOnce = false) => {
    for (const [i, file] of files.entries()) {
      const id = Math.random().toString(36).slice(2);
      setUploads((u) => [...u, { id, name: file.name, progress: 0 }]);
      try {
        // Caption goes on the first file (bridges put `body` ≠ `filename` as the caption).
        const extra = {};
        if (asDocument) extra.msgtype = 'm.file';
        if (viewOnce && /^(image|video)\//.test(file.type)) extra['dev.relay.view_once'] = true; // see the WhatsApp bridge patch
        if (i === 0 && caption.trim()) extra.body = caption.trim();
        const content = await uploadAttachment(client, room, file, (p) =>
          setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: p } : x))), extra);
        if (i === 0 && replyTo) content['m.relates_to'] = { 'm.in_reply_to': { event_id: replyTo.getId() } };
        await client.sendMessage(room.roomId, content);
      } catch (err) {
        notice({ title: 'Couldn’t send', body: `${file.name}\n${err.message}` });
      } finally {
        setUploads((u) => u.filter((x) => x.id !== id));
      }
    }
  };

  const sendVoice = async ({ file, duration, waveform, viewOnce }, replyTo) => {
    const content = await uploadAttachment(client, room, file, undefined, {
      msgtype: 'm.audio',
      body: 'Voice message',
      'org.matrix.msc3245.voice': {},
      'org.matrix.msc1767.audio': { duration, waveform },
      info: { duration },
      ...(viewOnce ? { 'dev.relay.view_once': true } : {}),
    });
    if (replyTo) content['m.relates_to'] = { 'm.in_reply_to': { event_id: replyTo.getId() } };
    await client.sendMessage(room.roomId, content);
  };

  const react = async (ev, key) => {
    const mine = reactionsFor(room, ev).find((r) => r.key === key)?.mine;
    if (mine) return client.redactEvent(room.roomId, mine.getId());
    uiSound(reactionSound(key));
    burstReaction(ev.getId(), key);
    return client.sendEvent(room.roomId, 'm.reaction', {
      'm.relates_to': { rel_type: 'm.annotation', event_id: ev.getId(), key },
    });
  };

  const remove = async (ev) => {
    if (ev.status === EventStatus.NOT_SENT) return client.cancelPendingEvent(ev);
    if (await ask({ title: 'Delete message?', body: 'It will be deleted for everyone in the chat.', ok: 'Delete for everyone', danger: true })) client.redactEvent(room.roomId, ev.getId());
  };

  const startEdit = (ev) => { setReplyTo(null); setEditing(ev); composerRef.current?.focus(); };
  const startReply = (ev) => { setEditing(null); setReplyTo(ev); composerRef.current?.focus(); };

  // ----- Read state for the last message I sent -----
  // Read ticks: find the newest event anyone else (not bots) has read up to.
  const timelineEvents = timeline.getEvents();
  const indexOf = new Map(timelineEvents.map((e, i) => [e.getId(), i]));
  // Each other person's read position, with the time they read it (from their receipt).
  const readers = [];
  for (const m of room.getJoinedMembers()) {
    if (m.userId === me || /bot:/.test(m.userId)) continue;
    const upTo = room.getEventReadUpTo(m.userId);
    const i = upTo ? indexOf.get(upTo) : undefined;
    if (i === undefined) continue;
    const receipt = room.getReadReceiptForUserId(m.userId, true);
    readers.push({ userId: m.userId, index: i, ts: receipt?.data?.ts || null });
  }
  const readIndex = readers.reduce((n, r) => Math.max(n, r.index), -1);

  const seenWhen = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return time;
    if (d.toDateString() === new Date(now - 86400000).toDateString()) return `yesterday at ${time}`;
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  };
  // Bridge send statuses: failures, and which of my messages reached the other phone (DMs only).
  const MSS = 'com.beeper.message_send_status';
  const sendStatus = new Map();
  let deliveredIndex = -1;
  for (const e of room.getLiveTimeline().getEvents()) {
    if (e.getType() !== MSS) continue;
    const c = e.getContent();
    const target = c.relates_to?.event_id || c['m.relates_to']?.event_id;
    if (!target) continue;
    sendStatus.set(target, c);
    if (c.delivered_to_users?.length) deliveredIndex = Math.max(deliveredIndex, indexOf.get(target) ?? -1);
  }

  // Who read a message, newest first, for the "Seen by" list.
  const seenList = (seen) => [...seen]
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .map((r) => ({ userId: r.userId, name: senderName(room, r.userId), avatar: memberAvatar(client, room, r.userId, 48), when: seenWhen(r.ts) }));

  const receiptFor = (ev) => {
    if (ev.status) return { state: 'sending', title: 'Sending…' };
    const i = indexOf.get(ev.getId()) ?? Infinity;
    const seen = readers.filter((r) => r.index >= i);
    if (!seen.length) {
      const st = sendStatus.get(ev.getId());
      // Delivery is in order: a later message that arrived means this one did too.
      if (i <= deliveredIndex) return { state: 'delivered', title: 'Delivered', short: 'Delivered' };
      if (st && (st.status === 'FAIL' || st.status === 'RETRIABLE')) {
        return { state: 'failed', title: st.message || 'Not delivered', short: 'Not delivered' };
      }
      return { state: 'sent', title: 'Sent' };
    }
    if (!isGroup) {
      const when = seenWhen(seen[0].ts);
      return { state: 'read', title: when ? `Seen ${/^\d/.test(when) ? 'at ' : ''}${when}` : 'Seen', short: when ? `Seen ${when}` : 'Seen' };
    }
    const names = seen.map((r) => senderName(room, r.userId).split(' ')[0]);
    return {
      state: 'read',
      title: `Seen by ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''}`,
      short: `Seen by ${seen.length}`,
      readers: seenList(seen),
    };
  };
  // Beeper-style status line under your newest message.
  const lastMine = [...events].reverse().find((e) => e.getSender() === me);

  const typing = room.getMembers().filter((m) => m.typing && m.userId !== me);
  // WhatsApp's "recording audio…" arrives as typing; ask the bridge which of them are recording.
  const [recordingIds, setRecordingIds] = useState([]);
  const typingKey = typing.map((m) => m.userId).join(',');
  useEffect(() => {
    const ask = window.relay.local?.recording;
    if (!typingKey || !ask || !/^whatsapp/.test(info.network || '')) { setRecordingIds([]); return undefined; }
    let alive = true;
    const poll = () => ask(room.roomId).then((ids) => alive && setRecordingIds(ids || []));
    poll();
    const t = setInterval(poll, 1500);
    return () => { alive = false; clearInterval(t); };
  }, [typingKey, room.roomId, info.network]);
  const recording = typing.filter((m) => recordingIds.includes(m.userId));
  const writing = typing.filter((m) => !recordingIds.includes(m.userId));

  const messageProps = (ev) => ({
    client: client,
    room: room,
    ev: ev,
    mine: ev.getSender() === me,
    showSender: isGroup,
    avatar: memberAvatar(client, room, ev.getSender()),
    sender: senderName(room, ev.getSender()),
    receipt: ev.getSender() === me ? receiptFor(ev) : null,
    statusLine: ev === lastMine && !ev.status ? receiptFor(ev) : null,
    seenBy: isGroup && ev.getSender() === me && !ev.status ? () => receiptFor(ev).readers || [] : null,
    starred: isStarred(room, ev.getId()),
    selecting: !!msgSel,
    selected: !!msgSel?.has(ev.getId()),
    onToggleSelect: toggleMsg,
    onSelectStart: (e) => setMsgSel(new Set([e.getId()])),
    onForward: (e) => setForwarding([e]),
    replies: repliesTo.get(ev.getId()),
    onOpenThread: (e) => setThreadRoot(e.getId()),
    onStar: (e) => toggleStar(client, room, e),
    onToast: showToast,
    onReact: react,
    onReply: startReply,
    onEdit: startEdit,
    onDelete: remove,
    onRetry: (e) => client.resendEvent(e, room),
    onOpenImage: openMedia,
    onOpenDirect: isGroup ? (userId) => actions.openDirect(userId, info) : undefined,
  });

  // ----- Render -----
  const rows = [];
  let prev = null;
  for (const ev of events) {
    const ts = ev.getTs();
    if (!prev || new Date(prev.getTs()).toDateString() !== new Date(ts).toDateString()) {
      rows.push(<div key={`day-${ts}`} className="day-sep"><span>{formatDay(ts)}</span></div>);
      prev = null;
    }
    const continued = prev && prev.getSender() === ev.getSender() && ts - prev.getTs() < GROUP_GAP_MS;
    rows.push(<Message key={ev.getId() || ev.getTxnId()} {...messageProps(ev)} continued={continued} />);
    prev = ev;
  }

  if (info.invite) {
    const inviter = room.getDMInviter() || room.getMember(me)?.events.member?.getSender();
    return (
      <section className="chat">
        <div className="chat-main">
        <ChatHeader client={client} info={info} onToggleInfo={() => {}} />
        <div className="invite">
          <Avatar src={roomAvatar(client, room, 160)} name={info.name} id={room.roomId} size={88} network={info.network} />
          <h2>{info.name}</h2>
          <p className="muted">{inviter ? `${senderName(room, inviter)} invited you` : 'You’ve been invited to this chat'}</p>
          <div className="row">
            <button onClick={() => client.leave(room.roomId)}>Decline</button>
            <button className="primary" onClick={() => client.joinRoom(room.roomId)}>Accept</button>
          </div>
        </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`chat ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); stageFiles([...e.dataTransfer.files]); }}
    >
      <div className="chat-main">
      <ChatWallpaper client={client} room={room} />
      <ChatHeader client={client} info={info} infoOpen={infoOpen} onToggleInfo={toggleInfo} />

      <div className={`timeline ${threadRoot ? 'behind-thread' : ''}`} ref={scrollRef} onScroll={onScroll}>
        <div className="timeline-inner">
          {atStart ? (
            <div className="timeline-start muted">
              <Avatar src={roomAvatar(client, room, 160)} name={info.name} id={room.roomId} size={64} network={info.network} />
              <div>This is the beginning of {info.name}</div>
              {room.hasEncryptionStateEvent() && <div className="small">🔒 Messages are end-to-end encrypted</div>}
            </div>
          ) : loadingOlder ? <div className="timeline-loading"><div className="spinner small" /></div> : <div className="timeline-pad" />}
          {rows}
          {recording.length > 0 && (
            <div className="typing recording">
              <svg className="rec-mic" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2Z" /></svg>
              {recording.length === 1 ? `${cleanName(recording[0].rawDisplayName || recording[0].name)} is recording audio` : `${recording.length} people are recording audio`}
            </div>
          )}
          {writing.length > 0 && (
            <div className="typing">
              <span className="dots"><i /><i /><i /></span>
              {writing.length === 1 ? `${cleanName(writing[0].rawDisplayName || writing[0].name)} is typing` : `${writing.length} people are typing`}
            </div>
          )}
        </div>
      </div>

      {threadRoot && threadEvents.length > 0 && (
        <div className="thread-focus" onMouseDown={(e) => { if (e.target === e.currentTarget) setThreadRoot(null); }}>
          <div className="thread-panel">
            <div className="thread-head">
              <span>Thread · {threadEvents.length} message{threadEvents.length > 1 ? 's' : ''}</span>
              <button onClick={() => setThreadRoot(null)} title="Close (Esc)">✕</button>
            </div>
            <div className="thread-list">
              {threadEvents.map((ev, i) => (
                <Message key={ev.getId()} {...messageProps(ev)} showSender continued={false}
                  onReply={(e) => { setThreadRoot(null); startReply(e); }}
                  onOpenThread={undefined}
                  className={ev.getId() === threadRoot ? 'thread-target' : ''} />
              ))}
            </div>
          </div>
        </div>
      )}

      {uploads.length > 0 && (
        <div className="uploads">
          {uploads.map((u) => (
            <div key={u.id} className="upload"><span>{u.name}</span><progress value={u.progress} max={1} /></div>
          ))}
        </div>
      )}

      {msgSel ? (() => {
        const picked = events.filter((e) => msgSel.has(e.getId()));
        const mineOnly = picked.length && picked.every((e) => e.getSender() === me);
        return (
          <div className="msg-select-bar">
            <button className="bulk-link" onClick={() => setMsgSel(null)}>Cancel</button>
            <span className="bulk-count">{picked.length} selected</span>
            <div className="msb-actions">
              <button disabled={!picked.length} onClick={() => setForwarding(picked)}>Forward</button>
              <button disabled={!picked.length} onClick={() => {
                const text = picked.map((e) => `[${new Date(e.getTs()).toLocaleString()}] ${senderName(room, e.getSender())}: ${forwardContent(e).body || ''}`).join('\n');
                navigator.clipboard.writeText(text);
                showToast('Copied');
                setMsgSel(null);
              }}>Copy</button>
              <button disabled={!picked.length} onClick={() => { picked.forEach((e) => { if (!isStarred(room, e.getId())) toggleStar(client, room, e); }); setMsgSel(null); showToast('Starred'); }}>Star</button>
              <button className="danger-tool" disabled={!mineOnly} title={mineOnly ? '' : 'You can only delete your own messages'}
                onClick={async () => { if (await ask({ title: `Delete ${picked.length} message${picked.length > 1 ? 's' : ''}?`, body: 'They will be deleted for everyone in the chat.', ok: 'Delete for everyone', danger: true })) { picked.forEach((e) => client.redactEvent(room.roomId, e.getId())); setMsgSel(null); } }}>Delete</button>
            </div>
          </div>
        );
      })() : (
      <Composer
        ref={composerRef}
        client={client}
        room={room}
        network={net}
        networkId={info.network}
        roomName={info.name}
        replyTo={replyTo}
        editing={editing}
        onCancel={() => { setReplyTo(null); setEditing(null); }}
        onSent={() => { setReplyTo(null); setEditing(null); if (scrollRef.current) scrollRef.current.scrollTop = 0; }}
        onEditLast={() => {
          const last = [...events].reverse().find((e) => e.getSender() === me && !e.isRedacted() && e.getContent().msgtype === 'm.text');
          if (last) startEdit(last);
        }}
        onFiles={stageFiles}
        staged={staged}
        onUnstage={unstage}
        onClearStaged={clearStaged}
        onSendStaged={sendStaged}
        onVoice={sendVoice}
      />
      )}
      {forwarding && (
        <ForwardDialog client={client} events={forwarding} onClose={() => setForwarding(null)}
          onDone={(n) => { setForwarding(null); setMsgSel(null); showToast(`Forwarded to ${n} chat${n > 1 ? 's' : ''}`); }} />
      )}
      {toast && <div className="toast">{toast}</div>}

      {dragging && <div className="drop-hint">Drop to send to {info.name}</div>}
      </div>
      {infoOpen && (
        <InfoPanel client={client} info={info} actions={actions} tick={tick}
          onClose={toggleInfo} onOpenImage={openMedia} onJump={jumpTo} />
      )}
      {lightbox && <Lightbox client={client} {...lightbox} onClose={() => setLightbox(null)} />}
    </section>
  );
}

function ChatHeader({ client, info, infoOpen, onToggleInfo }) {
  const { room } = info;
  const muted = isMuted(client, room.roomId);
  return (
    <header className="chat-float">
      <div className="drag-region" />
      <button className="float-id" onClick={onToggleInfo} title="Chat info">
        <Avatar src={roomAvatar(client, room, 120)} name={info.name} id={room.roomId} size={54} network={info.network} account={info.account} />
        <span className="float-name">
          {muted && <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 18.69 7.84 6.14 5.27 3.49 4 4.76l2.8 2.8v.01A6.96 6.96 0 0 0 6 11v5l-2 2v1h13.73l2 2L21 19.72l-1-1.03ZM12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm6-7.32V11a6.99 6.99 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16c-.47.1-.92.26-1.34.46L18 14.68Z" /></svg>}
          <span className="float-title">{info.name}</span>
          <svg viewBox="0 0 24 24" width="16" height="16" className={`chev ${infoOpen ? 'open' : ''}`}><path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4Z" /></svg>
        </span>
      </button>
      <button className={`float-panel-btn ${infoOpen ? 'on' : ''}`} onClick={onToggleInfo} title={infoOpen ? 'Hide details' : 'Show details'}>
        <svg viewBox="0 0 24 24" width="19" height="19"><path fill="currentColor" d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-4 16H5V5h10v14Zm4 0h-2V5h2v14Z" /></svg>
      </button>
    </header>
  );
}

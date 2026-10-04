// "Calls": WhatsApp-style call history, in the chat list's column.
// Two sources, merged: the bridge's call notices found in the loaded chat timelines, and the
// log the main process keeps (calls placed from Relay, rings it showed and how they ended).
import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import { PHONE_D, VIDEO_D, WAITING_FOR_QR } from './CallUI.jsx';
import { callAction, roomAvatar, formatDay } from '../matrix.js';
import { useCalls, useCallHistory, markCallsSeen, startCall, spokenDuration, callsAvailable } from '../calls.js';

const Svg = ({ d, size = 16 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
const ARROW_IN = 'M20 5.41 18.59 4 7 15.59V9H5v10h10v-2H8.41L20 5.41Z';
const ARROW_OUT = 'M9 5v2h6.59L4 18.59 5.41 20 17 8.41V15h2V5H9Z';

// state → [label, tone]
const STATES = {
  ringing: ['Ringing now', 'ringing'],
  answered: ['Incoming', 'ok'],
  ended: ['Incoming', 'ok'], // rang and stopped: answered on the phone, or the caller gave up
  incoming: ['Incoming', 'ok'],
  missed: ['Missed', 'missed'],
  declined: ['Declined', 'declined'],
  outgoing: ['Outgoing', 'ok'],
};

const SAME_CALL = 2 * 60 * 1000;

/** Bridge call notices in what's loaded of each chat. */
function timelineCalls(client, rooms) {
  const me = client.getUserId();
  const out = [];
  for (const r of rooms) {
    if (!/^whatsapp/.test(r.baseNetwork || r.network || '')) continue;
    for (const ev of r.room.getLiveTimeline().getEvents()) {
      const call = callAction(ev);
      if (!call || ev.isRedacted()) continue;
      const mine = ev.getSender() === me;
      out.push({ id: ev.getId(), ts: ev.getTs(), dir: mine ? 'out' : 'in', state: mine ? 'outgoing' : 'incoming', video: call.video, roomId: r.id, name: r.name });
    }
  }
  return out;
}

function mergeCalls(log, fromTimeline) {
  const entries = log.map((e) => ({ ...e }));
  for (const t of fromTimeline) {
    // The same call seen by both: the log knows how it ended, the notice which chat it was.
    const twin = entries.find((e) => !e.matched && e.dir === t.dir && Math.abs(e.ts - t.ts) < SAME_CALL
      && (e.roomId ? e.roomId === t.roomId : e.name === t.name));
    if (twin) { twin.matched = true; twin.roomId ||= t.roomId; continue; }
    entries.push(t);
  }
  return entries.sort((a, b) => b.ts - a.ts);
}

/** Back-to-back calls with the same person and outcome on the same day fold into one row, like WhatsApp. */
function fold(entries) {
  const rows = [];
  for (const e of entries) {
    const prev = rows.at(-1);
    const key = `${e.roomId || e.name}|${e.dir}|${e.state === 'missed'}|${new Date(e.ts).toDateString()}`;
    if (prev && prev.key === key) { prev.count++; prev.video ||= e.video; continue; }
    rows.push({ ...e, key, count: 1 });
  }
  return rows;
}

const timeOf = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function CallHistory({ client, rooms, activeId, onOpen, onSettings }) {
  const calls = useCalls();
  const { entries: log, seenAt } = useCallHistory();
  const [filter, setFilter] = useState('all');
  const [toast, setToast] = useState(null);

  const byId = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  const all = useMemo(() => mergeCalls(log, timelineCalls(client, rooms)), [log, rooms, client]);
  const missedCount = all.filter((e) => e.state === 'missed').length;
  const rows = useMemo(() => fold(filter === 'missed' ? all.filter((e) => e.state === 'missed') : all), [all, filter]);

  // Looking at the list counts as having seen the missed calls (clears the rail badge).
  useEffect(() => {
    if (log.some((e) => e.state === 'missed' && e.ts > seenAt)) markCallsSeen();
  }, [log, seenAt]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const callBack = async (e, row) => {
    e.stopPropagation();
    const r = await startCall(row.roomId, row.video, byId.get(row.roomId)?.name || row.name);
    if (r && !r.ok && r.error) setToast(r.error);
    else if (r?.waiting) setToast(WAITING_FOR_QR);
  };

  let lastDay = null;
  return (
    <aside className="sidebar calls-side">
      <header className="sidebar-head">
        <div className="drag-region" />
        <div className="sidebar-title">
          <h2>Calls</h2>
        </div>
        <div className="chips">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
          <button className={filter === 'missed' ? 'on' : ''} onClick={() => setFilter('missed')}>
            Missed{missedCount ? ` · ${missedCount}` : ''}
          </button>
        </div>
      </header>

      {callsAvailable() && !(calls.linked && calls.enabled) && (
        <button className="chl-connect" onClick={onSettings}>
          <span className="chl-connect-ico"><Svg d={PHONE_D} size={15} /></span>
          <span><b>{calls.linked ? 'Calls are paused' : 'Call from your computer'}</b>
            <small>{calls.linked ? 'Turn on “Receive calls on this computer”' : 'Link WhatsApp Web in Settings → Calls'}</small></span>
        </button>
      )}

      <div className="room-list chl-list">
        {rows.length === 0 && (
          <div className="chl-empty">
            <span className="chl-empty-art"><Svg d={filter === 'missed' ? ARROW_IN : PHONE_D} size={30} /></span>
            <b>{filter === 'missed' ? 'No missed calls' : 'No calls yet'}</b>
            <p>{filter === 'missed' ? 'Calls you miss show up here.' : 'Your WhatsApp voice and video calls show up here.'}</p>
          </div>
        )}
        {rows.map((row) => {
          const day = formatDay(row.ts);
          const header = day !== lastDay ? <div className="chl-day" key={`d-${row.key}-${row.ts}`}>{day}</div> : null;
          lastDay = day;
          const room = row.roomId && byId.get(row.roomId);
          const name = room?.name || row.name || 'WhatsApp';
          const [label, tone] = STATES[row.state] || STATES.incoming;
          const canCall = !!room && !calls.inCall && callsAvailable();
          return [
            header,
            <div key={row.id} role="button" tabIndex={0}
              className={`chl-row ${tone} ${row.roomId && row.roomId === activeId ? 'active' : ''} ${room ? '' : 'orphan'}`}
              onClick={() => room && onOpen(room.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' && room) onOpen(room.id); }}>
              <Avatar src={room ? roomAvatar(client, room.room, 96) : null} name={name} id={row.roomId || name} size={44} network={room?.network} account={room?.account} />
              <div className="chl-main">
                <div className="chl-top">
                  <span className="chl-name">{name}{row.count > 1 && <em> ({row.count})</em>}</span>
                  <span className="chl-time">{timeOf(row.ts)}</span>
                </div>
                <div className="chl-sub">
                  <span className={`chl-arrow ${tone}`}><Svg d={row.dir === 'out' ? ARROW_OUT : ARROW_IN} size={13} /></span>
                  <span className="chl-state">{label}</span>
                  <span className="chl-dot">·</span>
                  <span className="chl-kind" title={row.video ? 'Video call' : 'Voice call'}><Svg d={row.video ? VIDEO_D : PHONE_D} size={13} /></span>
                  {row.count === 1 && row.duration > 0 && <><span className="chl-dot">·</span><span className="chl-dur">{spokenDuration(row.duration)}</span></>}
                </div>
              </div>
              <button className={`chl-call ${row.video ? 'video' : ''}`} disabled={!canCall} onClick={(e) => callBack(e, row)}
                title={room ? (row.video ? 'Video call back' : 'Call back') : 'Chat not found'}
                aria-label={row.video ? 'Video call back' : 'Call back'}>
                <Svg d={row.video ? VIDEO_D : PHONE_D} size={16} />
              </button>
            </div>,
          ];
        })}
      </div>
      {toast && <div className="chl-toast" onClick={() => setToast(null)}>{toast}</div>}
    </aside>
  );
}

/** Rail button for "Calls", with a red count of missed calls not yet seen. */
export function CallsRailButton({ active, onOpen, onClose }) {
  const { entries, seenAt } = useCallHistory();
  const missed = entries.filter((e) => e.state === 'missed' && e.ts > seenAt).length;
  // A missed-call notification without a chat opens the history.
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => window.relay.calls?.onShowHistory?.(() => openRef.current()), []);
  if (!callsAvailable()) return null;
  return (
    <button className={`rail-btn calls-rail ${active ? 'on' : ''} ${missed ? 'has-missed' : ''}`} onClick={active ? onClose : onOpen}
      title={missed ? `Calls · ${missed} missed` : 'Calls'}>
      <Svg d={PHONE_D} size={20} />
      {missed > 0 && <span className="rail-count calls-missed">{missed > 99 ? '99+' : missed}</span>}
    </button>
  );
}

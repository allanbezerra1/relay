// Scheduled messages: the time picker that opens from the send button, the strip above the
// composer listing a chat's scheduled messages, and the Settings pane with all of them.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useScheduled, scheduleMessage, updateScheduled, cancelScheduled, sendScheduledNow, schedulePresets, toLocalInput, formatWhen } from '../scheduled.js';
import { combo } from '../platform.js';
import { emit } from '../bus.js';

const P = {
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7Z',
  chevron: 'M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4Z',
  send: 'M12 4 5 11l1.41 1.41L11 7.83V20h2V7.83l4.59 4.58L19 11l-7-7Z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z',
  hour: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7Z',
  evening: 'M12.3 22A10 10 0 0 1 9.06 2.53a.75.75 0 0 1 .95.93 8 8 0 0 0 10.53 10.53.75.75 0 0 1 .93.95A10 10 0 0 1 12.3 22Z',
  morning: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM11 1h2v3h-2V1Zm0 19h2v3h-2v-3ZM1 11h3v2H1v-2Zm19 0h3v2h-3v-2Z',
  week: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 16H5V9h14v11ZM7 11h5v5H7v-5Z',
  custom: 'M17 12h-5v5h5v-5ZM16 1v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-1V1h-2Zm3 18H5V8h14v11Z',
  warn: 'M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z',
};
const Svg = ({ d, size = 16 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
const PRESET_ICON = { hour: P.hour, today: P.evening, tomorrow: P.morning, monday: P.week };
// The label already says when; the hint adds what it leaves out (the time, or the date).
function presetHint(p) {
  if (p.id === 'hour') return p.when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (p.id === 'tomorrow') return p.when.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  if (p.id === 'monday') return p.when.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return '';
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Popover above the send button. The text is editable here too, so it also works when
 * opened from the command palette with an empty composer.
 */
export function SchedulePopover({ text, roomId, roomName, onDone, onClose }) {
  const [body, setBody] = useState(text);
  const [custom, setCustom] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(Date.now() + 2 * 60 * 60 * 1000));
  const [sel, setSel] = useState(0);
  const [error, setError] = useState(null);
  const ref = useRef(null);
  const presets = useMemo(() => schedulePresets(), []);
  const options = [...presets.map((p) => p.id), 'custom'];

  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [onClose]);
  useEffect(() => { if (text) ref.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const schedule = async (ts) => {
    if (!body.trim()) { setError('Write the message before scheduling it.'); return; }
    if (!ts || ts < Date.now() + 30 * 1000) { setError('Pick a time in the future.'); return; }
    try {
      await scheduleMessage({ roomId, roomName, body: body.trim(), sendAt: ts });
      onDone(ts);
    } catch (err) {
      setError(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };
  // Leaving the date field unmounts the focused input; keep focus in the popover so keys still work.
  const back = () => { setCustom(false); requestAnimationFrame(() => ref.current?.focus()); };
  const pick = (id) => {
    if (id === 'custom') { setCustom(true); return; }
    schedule(presets.find((p) => p.id === id).when.getTime());
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (custom) back(); else onClose(); return; }
    if (e.target.tagName === 'TEXTAREA' || custom) {
      if (custom && e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); schedule(new Date(when).getTime()); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + options.length) % options.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(options[sel]); }
  };

  return (
    <div className="sched-pop" ref={ref} tabIndex={-1} onKeyDown={onKey} role="dialog" aria-label="Schedule message">
      <div className="sched-head">
        <span className="sched-head-icon"><Svg d={P.clock} size={16} /></span>
        <div>
          <div className="sched-title">Schedule message</div>
          <div className="sched-sub">to {roomName}</div>
        </div>
      </div>
      <textarea className="sched-body" value={body} onChange={(e) => { setBody(e.target.value); setError(null); }} rows={Math.min(4, Math.max(2, body.split('\n').length))}
        placeholder="Message" autoFocus={!text} />
      {!custom ? (
        <div className="sched-options">
          {presets.map((p, i) => (
            <button key={p.id} className={sel === i ? 'sel' : ''} onMouseEnter={() => setSel(i)} onClick={() => pick(p.id)}>
              <span className="sched-opt-icon"><Svg d={PRESET_ICON[p.id]} size={15} /></span>
              <span className="sched-opt-label">{p.label}</span>
              <span className="sched-opt-when">{presetHint(p)}</span>
            </button>
          ))}
          <button className={sel === presets.length ? 'sel' : ''} onMouseEnter={() => setSel(presets.length)} onClick={() => pick('custom')}>
            <span className="sched-opt-icon"><Svg d={P.custom} size={15} /></span>
            <span className="sched-opt-label">Pick date &amp; time…</span>
          </button>
        </div>
      ) : (
        <div className="sched-custom">
          <input type="datetime-local" value={when} min={toLocalInput(Date.now())} onChange={(e) => { setWhen(e.target.value); setError(null); }} autoFocus />
          <div className="sched-custom-row">
            <button className="sched-ghost" onClick={back}>Back</button>
            <button className="sched-primary" onClick={() => schedule(new Date(when).getTime())}>Schedule · {when ? formatWhen(new Date(when).getTime()) : ''}</button>
          </div>
        </div>
      )}
      {error && <div className="sched-error">{error}</div>}
      <div className="sched-foot">Sends even with the window closed, as long as Relay is running.</div>
    </div>
  );
}

/** One scheduled message, with edit / send now / cancel. */
export function ScheduledItem({ item, showRoom, onOpenRoom }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(item.body);
  const [when, setWhen] = useState(toLocalInput(item.sendAt));
  const [busy, setBusy] = useState(false);
  const failed = item.status === 'failed';
  const late = !failed && item.attempts > 0;

  const save = async () => {
    const ts = new Date(when).getTime();
    if (!body.trim() || !ts) return;
    await updateScheduled(item.id, { body: body.trim(), sendAt: ts });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="sched-item editing">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(5, Math.max(2, body.split('\n').length))} autoFocus
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }} />
        <div className="sched-edit-row">
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <span className="sched-spacer" />
          <button className="sched-ghost" onClick={() => { setEditing(false); setBody(item.body); setWhen(toLocalInput(item.sendAt)); }}>Cancel</button>
          <button className="sched-primary" onClick={save} title={`Save (${combo('Enter')})`}>Save</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`sched-item ${failed ? 'failed' : ''}`}>
      <div className="sched-item-main">
        <div className="sched-item-top">
          <span className={`sched-when ${failed ? 'bad' : late ? 'late' : ''}`}><Svg d={failed || late ? P.warn : P.clock} size={12} />{capitalize(formatWhen(item.sendAt))}</span>
          {showRoom && <button className="sched-room" onClick={() => onOpenRoom?.(item.roomId)}>{item.roomName || 'Chat'}</button>}
        </div>
        <div className="sched-text">{item.body}</div>
        {(failed || late) && <div className="sched-status">{failed ? `Not sent: ${item.lastError}` : `Retrying… (${item.lastError})`}</div>}
      </div>
      <div className="sched-actions">
        <button title="Edit" onClick={() => setEditing(true)}><Svg d={P.edit} size={15} /></button>
        <button title="Send now" disabled={busy} onClick={async () => { setBusy(true); try { await sendScheduledNow(item.id); } finally { setBusy(false); } }}><Svg d={P.send} size={15} /></button>
        <button title="Cancel" className="danger" onClick={() => cancelScheduled(item.id)}><Svg d={P.trash} size={15} /></button>
      </div>
    </div>
  );
}

/** "1 scheduled message · tomorrow 9:00 AM" above the composer; expands to the list. */
export function ScheduledStrip({ roomId }) {
  const list = useScheduled(roomId);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!list.length) setOpen(false); }, [list.length]);
  if (!list.length) return null;
  const failed = list.some((m) => m.status === 'failed');
  return (
    <div className={`sched-strip ${open ? 'open' : ''} ${failed ? 'has-failed' : ''}`}>
      <button className="sched-strip-bar" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="sched-strip-icon"><Svg d={failed ? P.warn : P.clock} size={14} /></span>
        <span className="sched-strip-text">
          <b>{plural(list.length, 'scheduled message', 'scheduled messages')}</b>
          <span> · {failed ? 'one failed' : list.length > 1 ? `next ${formatWhen(list[0].sendAt)}` : formatWhen(list[0].sendAt)}</span>
        </span>
        <span className={`sched-strip-chev ${open ? 'open' : ''}`}><Svg d={P.chevron} size={16} /></span>
      </button>
      {open && (
        <div className="sched-strip-list">
          {list.map((m) => <ScheduledItem key={m.id} item={m} />)}
        </div>
      )}
    </div>
  );
}

/** Settings → Scheduled: every chat's, soonest first. */
export function ScheduledPane({ onOpenRoom = (id) => emit('open-room', id) }) {
  const list = useScheduled();
  return (
    <>
      <h2 className="pane-title">Scheduled messages</h2>
      <p className="pane-lead">Write now, send later. To schedule a message, right-click (or press and hold) the send button, or press <kbd>{combo('Shift+Enter')}</kbd> in the message field.</p>
      {list.length ? (
        <section className="group">
          <div className="group-body sched-pane-list">
            {list.map((m) => <ScheduledItem key={m.id} item={m} showRoom onOpenRoom={onOpenRoom} />)}
          </div>
        </section>
      ) : (
        <div className="power-empty">
          <span className="power-empty-icon"><Svg d={P.clock} size={26} /></span>
          <b>No scheduled messages</b>
          <span>Scheduled messages show up here and above the message field of their chat.</span>
        </div>
      )}
    </>
  );
}

// "Remind me about this…": the dialog that opens from a message's menu, the 🔔 chip on messages
// with a pending reminder, and Settings → Reminders with all of them.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useReminders, useMessageReminder, addReminder, updateReminder, removeReminder, reminderPresets, askReminder,
  toLocalInput, formatWhen, emitReminder, onReminder,
} from '../reminders.js';

const P = {
  bell: 'M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z',
  timer: 'M15 1H9v2h6V1Zm-4 13h2V8h-2v6Zm8.03-6.61 1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.96 8.96 0 0 0 12 4a9 9 0 1 0 9 9c0-2.12-.74-4.07-1.97-5.61ZM12 20a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z',
  hour: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7Z',
  evening: 'M12.3 22A10 10 0 0 1 9.06 2.53a.75.75 0 0 1 .95.93 8 8 0 0 0 10.53 10.53.75.75 0 0 1 .93.95A10 10 0 0 1 12.3 22Z',
  morning: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM11 1h2v3h-2V1Zm0 19h2v3h-2v-3ZM1 11h3v2H1v-2Zm19 0h3v2h-3v-2Z',
  custom: 'M17 12h-5v5h5v-5ZM16 1v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-1V1h-2Zm3 18H5V8h14v11Z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z',
  jump: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6-6-6Z',
  note: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm2 16H8v-2h8v2Zm0-4H8v-2h8v2Zm-3-5V3.5L18.5 9H13Z',
};
const Svg = ({ d, size = 16 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
const PRESET_ICON = { m20: P.timer, h1: P.hour, today: P.evening, tomorrow: P.morning };
const hhmm = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const presetHint = (p) => (p.id === 'tomorrow' ? p.when.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : hhmm(p.when));

/** Mounted once; opens the dialog when a message asks for it (askReminder). */
export function ReminderHost() {
  const [target, setTarget] = useState(null);
  useEffect(() => onReminder('remind-message', setTarget), []);
  if (!target) return null;
  return createPortal(<ReminderDialog target={target} onClose={() => setTarget(null)} />, document.body);
}

function ReminderDialog({ target, onClose }) {
  const existing = useMessageReminder(target.roomId, target.eventId);
  const [note, setNote] = useState(target.note ?? existing?.note ?? '');
  const [custom, setCustom] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(existing?.remindAt || Date.now() + 2 * 60 * 60 * 1000));
  const [sel, setSel] = useState(0);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const ref = useRef(null);
  const presets = useMemo(() => reminderPresets(), []);
  const options = [...presets.map((p) => p.id), 'custom'];

  useEffect(() => { ref.current?.focus(); }, []);

  const save = async (ts) => {
    if (!ts || ts < Date.now() + 20 * 1000) { setError('Pick a time in the future.'); return; }
    try {
      await addReminder({ roomId: target.roomId, roomName: target.roomName, eventId: target.eventId, sender: target.sender, text: target.text, note: note.trim(), remindAt: ts });
      setDone(ts);
      setTimeout(onClose, 900);
    } catch (err) {
      setError(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };
  const pick = (id) => {
    if (id === 'custom') { setCustom(true); return; }
    save(presets.find((p) => p.id === id).when.getTime());
  };
  const back = () => { setCustom(false); requestAnimationFrame(() => ref.current?.focus()); };

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (custom) back(); else onClose(); return; }
    if (e.target.tagName === 'INPUT' && e.target.type === 'datetime-local') {
      if (e.key === 'Enter') { e.preventDefault(); save(new Date(when).getTime()); }
      return;
    }
    if (custom) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + options.length) % options.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(options[sel]); }
  };

  return (
    <div className="rem-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`rem-dialog ${done ? 'done' : ''}`} ref={ref} tabIndex={-1} onKeyDown={onKey} role="dialog" aria-label="Remind me about this">
        <div className="rem-head">
          <span className="rem-head-icon"><Svg d={P.bell} size={18} /></span>
          <div className="rem-head-text">
            <div className="rem-title">{existing ? 'Change reminder' : 'Remind me about this'}</div>
            <div className="rem-sub">{existing ? `Now: ${formatWhen(existing.remindAt)}` : `in ${target.roomName || 'this chat'}`}</div>
          </div>
          <button className="rem-x" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="rem-quote">
          {target.sender && <b>{target.sender}</b>}
          <span>{target.text || 'Message'}</span>
        </div>
        <label className="rem-note">
          <Svg d={P.note} size={15} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional)" maxLength={500}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick(options[sel]); } }} />
        </label>
        {done ? (
          <div className="rem-done"><Svg d={P.bell} size={16} /> Got it: {formatWhen(done)}</div>
        ) : !custom ? (
          <div className="rem-options">
            {presets.map((p, i) => (
              <button key={p.id} className={sel === i ? 'sel' : ''} onMouseEnter={() => setSel(i)} onClick={() => pick(p.id)}>
                <span className="rem-opt-icon"><Svg d={PRESET_ICON[p.id]} size={15} /></span>
                <span className="rem-opt-label">{p.label}</span>
                <span className="rem-opt-when">{presetHint(p)}</span>
              </button>
            ))}
            <button className={sel === presets.length ? 'sel' : ''} onMouseEnter={() => setSel(presets.length)} onClick={() => pick('custom')}>
              <span className="rem-opt-icon"><Svg d={P.custom} size={15} /></span>
              <span className="rem-opt-label">Pick a time…</span>
            </button>
          </div>
        ) : (
          <div className="rem-custom">
            <input type="datetime-local" value={when} min={toLocalInput(Date.now())} onChange={(e) => { setWhen(e.target.value); setError(null); }} autoFocus />
            <div className="rem-custom-row">
              <button className="rem-ghost" onClick={back}>Back</button>
              <button className="rem-primary" onClick={() => save(new Date(when).getTime())}>Remind me · {when ? formatWhen(new Date(when).getTime()) : ''}</button>
            </div>
          </div>
        )}
        {error && <div className="rem-error">{error}</div>}
        <div className="rem-foot">
          {existing && !done && <button className="rem-remove" onClick={() => { removeReminder(existing.id); onClose(); }}><Svg d={P.trash} size={13} /> Remove reminder</button>}
          <span>Arrives as a notification, even with the window closed.</span>
        </div>
      </div>
    </div>
  );
}

/** 🔔 under a message that has a pending reminder; click to change it. */
export function ReminderChip({ roomId, eventId, roomName, sender, text }) {
  const r = useMessageReminder(roomId, eventId);
  const ref = useRef(null);
  if (!r) return null;
  return (
    <button ref={ref} className="rem-chip" title={r.note ? `Reminder: ${r.note}` : 'Pending reminder · click to change'}
      onClick={(e) => { e.stopPropagation(); askReminder({ roomId, eventId, roomName: roomName || r.roomName, sender: sender || r.sender, text: text || r.text }); }}>
      <Svg d={P.bell} size={12} />
      <span>{formatWhen(r.remindAt)}</span>
      {r.note && <span className="rem-chip-note">· {r.note}</span>}
    </button>
  );
}

function ReminderItem({ item }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(item.note || '');
  const [when, setWhen] = useState(toLocalInput(item.remindAt));
  const save = async () => {
    const ts = new Date(when).getTime();
    if (!ts) return;
    await updateReminder(item.id, { note: note.trim(), remindAt: ts });
    setEditing(false);
  };
  const jump = () => { emitReminder('open-room', item.roomId); };
  if (editing) {
    return (
      <div className="rem-item editing">
        <input className="rem-item-note-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" autoFocus
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } if (e.key === 'Enter') save(); }} />
        <div className="rem-edit-row">
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <span className="rem-spacer" />
          <button className="rem-ghost" onClick={() => { setEditing(false); setNote(item.note || ''); setWhen(toLocalInput(item.remindAt)); }}>Cancel</button>
          <button className="rem-primary" onClick={save}>Save</button>
        </div>
      </div>
    );
  }
  const late = item.remindAt < Date.now();
  return (
    <div className="rem-item">
      <div className="rem-item-main">
        <div className="rem-item-top">
          <span className={`rem-when ${late ? 'late' : ''}`}><Svg d={P.bell} size={12} />{formatWhen(item.remindAt)}</span>
          <button className="rem-room" onClick={jump} title="Open the chat">{item.roomName || 'Chat'}<Svg d={P.jump} size={14} /></button>
        </div>
        {item.note && <div className="rem-item-note">{item.note}</div>}
        <div className="rem-item-text">{item.sender ? <b>{item.sender}: </b> : null}{item.text || 'Message'}</div>
      </div>
      <div className="rem-actions">
        <button title="Edit" onClick={() => setEditing(true)}><Svg d={P.edit} size={15} /></button>
        <button title="Remove reminder" className="rem-danger" onClick={() => removeReminder(item.id)}><Svg d={P.trash} size={15} /></button>
      </div>
    </div>
  );
}

/** Settings → Reminders. */
export function RemindersPane() {
  const list = useReminders();
  return (
    <>
      <h2 className="pane-title">Reminders</h2>
      <p className="pane-text muted">Right-click a message and choose <b>Remind me about this</b>. At that time Relay shows a notification; click it to go back to the chat.</p>
      {list.length ? (
        <section className="group">
          <div className="group-body rem-pane-list">
            {list.map((r) => <ReminderItem key={r.id} item={r} />)}
          </div>
        </section>
      ) : (
        <div className="rem-empty">
          <span className="rem-empty-icon"><Svg d={P.bell} size={26} /></span>
          <b>No reminders</b>
          <span>Pending reminders show up here and with a 🔔 on the message itself.</span>
        </div>
      )}
    </>
  );
}

// Broadcast lists: the same message (and optionally a photo or file) sent to many people, each as
// an ordinary 1:1 message, one chat at a time (~1.5 s apart so WhatsApp doesn't flag it).
// Lists can be saved for reuse in account data (dev.relay.broadcast_lists).
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MsgType } from 'matrix-js-sdk';
import Avatar from './Avatar.jsx';
import { roomAvatar, peopleCount } from '../matrix.js';
import { networkInfo } from '../networks.js';
import { uploadAttachment } from '../media.js';
import { waKind, broadcastLists, saveBroadcastLists, ghostPhone, dmPartner, formatPhone } from '../whatsapp-power.js';

const GAP_MS = 1500;
export const MEGAPHONE = 'M18 11v2h4v-2h-4Zm-2 6.61c.96.71 2.21 1.65 3.2 2.39.4-.53.8-1.07 1.2-1.6-.99-.74-2.24-1.68-3.2-2.4-.4.54-.8 1.08-1.2 1.61ZM20.4 5.6c-.4-.53-.8-1.07-1.2-1.6-.99.74-2.24 1.68-3.2 2.4.4.53.8 1.07 1.2 1.6.96-.72 2.21-1.65 3.2-2.4ZM4 9a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1v4h2v-4h1l5 3V6L8 9H4Zm11.5 3c0-1.33-.58-2.53-1.5-3.35v6.69c.92-.81 1.5-2.01 1.5-3.34Z';

function Svg({ d, size = 18 }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
}

function useEsc(fn, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const esc = (e) => e.key === 'Escape' && fn();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [fn, enabled]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const first = (name) => name.split(' ')[0];

export default function BroadcastDialog({ client, rooms, onClose }) {
  const [step, setStep] = useState('pick'); // pick | write | send
  const [picked, setPicked] = useState(() => new Set());
  const [q, setQ] = useState('');
  const [net, setNet] = useState('whatsapp'); // whatsapp | all
  const [lists, setLists] = useState(() => broadcastLists(client));
  const [activeList, setActiveList] = useState(null);
  const [naming, setNaming] = useState(null); // string while naming a new list
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [progress, setProgress] = useState({}); // roomId -> 'wait' | 'sending' | 'ok' | 'err'
  const [errors, setErrors] = useState({});
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);
  const fileInput = useRef(null);
  const textRef = useRef(null);

  useEsc(onClose, !running);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // People you have 1:1 chats with (any network; most recent first).
  const people = useMemo(() => rooms
    .filter((r) => !r.invite && r.room && waKind(r.room) !== 'status')
    .filter((r) => { const k = waKind(r.room, r.baseNetwork || r.network); return k ? k === 'dm' : peopleCount(r.room) === 2; })
    .map((r) => ({ ...r, phone: ghostPhone(dmPartner(r.room, client.getUserId())) }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0)), [rooms, client]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const query = q.trim().toLowerCase();
  const digits = query.replace(/\D/g, '');
  const shown = people
    .filter((p) => net === 'all' || /^whatsapp/.test(p.network || ''))
    .filter((p) => !query || p.name.toLowerCase().includes(query) || (digits.length >= 3 && (p.phone || '').includes(digits)));

  const toggle = (id) => { setActiveList(null); setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const targets = [...picked].map((id) => byId.get(id)).filter(Boolean);

  const persist = async (next) => {
    setLists(next);
    try { await saveBroadcastLists(client, next); } catch (err) { window.alert(`Couldn’t save the list: ${err.message}`); }
  };
  const loadList = (l) => { setPicked(new Set(l.rooms.filter((id) => byId.has(id)))); setActiveList(l.id); };
  const saveList = async () => {
    const name = naming?.trim();
    if (!name || !picked.size) return;
    const existing = lists.find((l) => l.name.toLowerCase() === name.toLowerCase());
    const entry = { id: existing?.id || `bl${Date.now().toString(36)}`, name, rooms: [...picked], updated: Date.now() };
    await persist(existing ? lists.map((l) => (l.id === existing.id ? entry : l)) : [...lists, entry]);
    setActiveList(entry.id);
    setNaming(null);
  };
  const updateList = async () => {
    const l = lists.find((x) => x.id === activeList);
    if (l) await persist(lists.map((x) => (x.id === l.id ? { ...x, rooms: [...picked], updated: Date.now() } : x)));
  };
  const deleteList = async (l) => {
    if (!window.confirm(`Delete the list “${l.name}”?\n\nThe chats themselves aren’t affected.`)) return;
    await persist(lists.filter((x) => x.id !== l.id));
    if (activeList === l.id) setActiveList(null);
  };
  const active = lists.find((x) => x.id === activeList);
  const listChanged = active && (active.rooms.length !== picked.size || active.rooms.some((id) => !picked.has(id)));

  const pickFile = (f) => {
    if (!f) return;
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
  };

  const send = async () => {
    setStep('send');
    setRunning(true);
    cancelRef.current = false;
    setProgress(Object.fromEntries(targets.map((t) => [t.id, 'wait'])));
    setErrors({});
    let plainMedia = null; // unencrypted rooms can share one upload
    const body = text.trim();
    for (const [i, t] of targets.entries()) {
      if (cancelRef.current) break;
      setProgress((p) => ({ ...p, [t.id]: 'sending' }));
      try {
        let content;
        if (file) {
          const encrypted = t.room.hasEncryptionStateEvent();
          const extra = body ? { body } : {};
          if (!encrypted && plainMedia) content = { ...plainMedia };
          else {
            content = await uploadAttachment(client, t.room, file, undefined, extra);
            if (!encrypted) plainMedia = { ...content };
          }
        } else {
          content = { msgtype: MsgType.Text, body };
        }
        await client.sendMessage(t.id, content);
        setProgress((p) => ({ ...p, [t.id]: 'ok' }));
      } catch (err) {
        setProgress((p) => ({ ...p, [t.id]: 'err' }));
        setErrors((e) => ({ ...e, [t.id]: err.message }));
      }
      if (i < targets.length - 1 && !cancelRef.current) await sleep(GAP_MS);
    }
    setRunning(false);
  };

  const done = Object.values(progress).filter((s) => s === 'ok').length;
  const failed = Object.values(progress).filter((s) => s === 'err').length;
  const finished = step === 'send' && !running;
  const pct = targets.length ? Math.round(((done + failed) / targets.length) * 100) : 0;
  const eta = Math.ceil(((targets.length - done - failed) * GAP_MS) / 1000);
  const steps = ['pick', 'write', 'send'];

  return createPortal(
    <div className="overlay wa-overlay" onMouseDown={() => !running && onClose()}>
      <div className="dialog wa-dialog bc-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div className="wa-title">
            <span className="wa-title-icon bc"><Svg d={MEGAPHONE} size={18} /></span>
            <div>
              <h2>Broadcast</h2>
              <p className="wa-sub">The same message, sent to each person in a private chat</p>
            </div>
          </div>
          <button className="wa-x" onClick={onClose} disabled={running} title="Close (Esc)">✕</button>
        </header>
        <div className="bc-steps">
          {[['pick', 'Recipients'], ['write', 'Message'], ['send', 'Send']].map(([id, label], i) => (
            <span key={id} className={`bc-step ${step === id ? 'on' : ''} ${steps.indexOf(step) > i ? 'done' : ''}`}><i>{steps.indexOf(step) > i ? '✓' : i + 1}</i>{label}</span>
          ))}
        </div>

        {step === 'pick' && (
          <>
            {lists.length > 0 && (
              <div className="bc-lists">
                <span className="bc-lists-title">Saved lists</span>
                <div className="bc-lists-row">
                  {lists.map((l) => (
                    <span key={l.id} className={`bc-list ${activeList === l.id ? 'on' : ''}`}>
                      <button onClick={() => loadList(l)} title={`Select the ${l.rooms.length} chats in this list`}>
                        {l.name}<small>{l.rooms.length}</small>
                      </button>
                      <button className="bc-list-x" title="Delete list" onClick={() => deleteList(l)}>✕</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="bc-search-row">
              <input className="fw-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people by name or number" />
              <div className="wa-seg small" role="radiogroup">
                <button className={net === 'whatsapp' ? 'on' : ''} onClick={() => setNet('whatsapp')}>WhatsApp</button>
                <button className={net === 'all' ? 'on' : ''} onClick={() => setNet('all')}>All</button>
              </div>
            </div>
            {picked.size > 0 && (
              <div className="wa-chips">
                {targets.slice(0, 30).map((t) => (
                  <button key={t.id} className="wa-chip" onClick={() => toggle(t.id)} title="Remove">
                    <Avatar src={roomAvatar(client, t.room, 40)} name={t.name} id={t.id} size={20} />{first(t.name)}<span>✕</span>
                  </button>
                ))}
                {targets.length > 30 && <span className="wa-chip more">+{targets.length - 30}</span>}
              </div>
            )}
            <div className="fw-list bc-people">
              {shown.slice(0, 200).map((p) => (
                <button key={p.id} className={`fw-row ${picked.has(p.id) ? 'on' : ''}`} onClick={() => toggle(p.id)}>
                  <Avatar src={roomAvatar(client, p.room, 64)} name={p.name} id={p.id} size={34} network={p.network} />
                  <span className="fw-name">{p.name}<span className="muted small">{p.phone ? formatPhone(p.phone) : networkInfo(p.network).name}</span></span>
                  <span className={`sel-check static ${picked.has(p.id) ? 'on' : ''}`}>{picked.has(p.id) ? '✓' : ''}</span>
                </button>
              ))}
              {!shown.length && <div className="ip-empty">Nobody found.</div>}
            </div>
            <div className="wa-foot">
              {naming !== null ? (
                <form className="bc-name" onSubmit={(e) => { e.preventDefault(); saveList(); }}>
                  <input autoFocus value={naming} maxLength={40} onChange={(e) => setNaming(e.target.value)} placeholder="List name (e.g. Customers)"
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); } }} />
                  <button type="submit" className="wa-btn accent small" disabled={!naming.trim()}>Save</button>
                  <button type="button" className="wa-btn small" onClick={() => setNaming(null)}>Cancel</button>
                </form>
              ) : listChanged ? (
                <button className="wa-btn" onClick={updateList}>Update “{active.name}”</button>
              ) : active ? (
                <span className="muted small bc-saved">✓ List “{active.name}”</span>
              ) : (
                <button className="wa-btn" disabled={!picked.size} onClick={() => setNaming('')}>Save as list…</button>
              )}
              {naming === null && <span className="wa-foot-spacer" />}
              {naming === null && (
                <button className="wa-btn accent" disabled={!picked.size} onClick={() => { setStep('write'); setTimeout(() => textRef.current?.focus(), 0); }}>
                  Next{picked.size ? ` (${picked.size})` : ''}
                </button>
              )}
            </div>
          </>
        )}

        {step === 'write' && (
          <>
            <button className="bc-recipients" onClick={() => setStep('pick')} title="Edit recipients">
              <span className="bc-faces">
                {targets.slice(0, 5).map((t) => <Avatar key={t.id} src={roomAvatar(client, t.room, 48)} name={t.name} id={t.id} size={26} />)}
              </span>
              <span><b>{targets.length} {targets.length === 1 ? 'person' : 'people'}</b><small>{targets.slice(0, 3).map((t) => first(t.name)).join(', ')}{targets.length > 3 ? ` and ${targets.length - 3} more` : ''}</small></span>
              <span className="bc-edit">Edit</span>
            </button>
            <div className="bc-compose">
              <textarea ref={textRef} rows={5} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={file ? 'Caption (optional)' : 'Write a message…'} />
              {file && (
                <div className="bc-file">
                  {preview ? <img src={preview} alt="" /> : <span className="bc-file-ico">📎</span>}
                  <span className="bc-file-name">{file.name}</span>
                  <button className="wa-x" onClick={() => { setFile(null); setPreview(null); }} title="Remove attachment">✕</button>
                </div>
              )}
              <div className="bc-compose-tools">
                <button className="bc-attach" onClick={() => fileInput.current?.click()}>📎 {file ? 'Replace attachment' : 'Attach a photo, video or file'}</button>
                <span className="muted small">{text.length ? `${text.length} characters` : ''}</span>
              </div>
              <input ref={fileInput} type="file" hidden onChange={(e) => { pickFile(e.target.files[0]); e.target.value = ''; }} />
            </div>
            <p className="bc-note">Each person gets it as a private message and doesn’t see the other recipients. Sending takes about {Math.max(1, Math.ceil((targets.length * GAP_MS) / 1000))} s.</p>
            <div className="wa-foot">
              <button className="wa-btn" onClick={() => setStep('pick')}>Back</button>
              <span className="wa-foot-spacer" />
              <button className="wa-btn accent" disabled={!text.trim() && !file} onClick={send}>Send to {targets.length}</button>
            </div>
          </>
        )}

        {step === 'send' && (
          <>
            <div className="bc-progress">
              <div className="bc-progress-top">
                <b>{finished ? (cancelRef.current ? 'Sending stopped' : failed ? 'Done, with errors' : 'All sent!') : `Sending ${Math.min(targets.length, done + failed + 1)} of ${targets.length}…`}</b>
                <span className="muted small">{finished ? `${done} sent${failed ? ` · ${failed} failed` : ''}` : `about ${eta} s left`}</span>
              </div>
              <div className="bc-bar"><i style={{ width: `${pct}%` }} className={failed ? 'warn' : ''} /></div>
            </div>
            <div className="fw-list bc-status-list">
              {targets.map((t) => (
                <div key={t.id} className={`fw-row bc-row ${progress[t.id]}`}>
                  <Avatar src={roomAvatar(client, t.room, 64)} name={t.name} id={t.id} size={30} />
                  <span className="fw-name">{t.name}{errors[t.id] && <span className="bc-err small">{errors[t.id]}</span>}</span>
                  <span className={`bc-state ${progress[t.id]}`}>
                    {progress[t.id] === 'ok' ? '✓' : progress[t.id] === 'err' ? '!' : progress[t.id] === 'sending' ? <span className="spinner small" /> : <span className="bc-dot" />}
                  </span>
                </div>
              ))}
            </div>
            <div className="wa-foot">
              {running ? (
                <button className="wa-btn" onClick={() => { cancelRef.current = true; }}>Stop</button>
              ) : (
                <>
                  {failed > 0 && <button className="wa-btn" onClick={() => { setPicked(new Set(targets.filter((t) => progress[t.id] === 'err').map((t) => t.id))); setStep('write'); }}>Retry the failed ones</button>}
                  <span className="wa-foot-spacer" />
                  <button className="wa-btn accent" onClick={onClose}>Done</button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

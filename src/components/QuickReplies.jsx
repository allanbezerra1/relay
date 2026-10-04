// Quick replies: the /shortcut suggestions in the composer and the Settings pane to manage them.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuickReplies, saveQuickReplies, cleanShortcut, fillPlaceholders, PLACEHOLDERS } from '../quickreplies.js';
import { fold, fuzzyScore } from '../fuzzy.js';
import { combo } from '../platform.js';
import { emit } from '../bus.js';

const P = {
  bolt: 'M7 2v11h3v9l7-12h-4l4-8H7Z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z',
  gear: 'M19.43 12.98a7.8 7.8 0 0 0 0-1.96l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.49.49 0 0 0 .12.64l2.11 1.65a7.9 7.9 0 0 0 0 1.96l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z',
};
const Svg = ({ d, size = 16 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;

/**
 * Composer hook: while the text is "/something" (no spaces yet), suggest saved replies.
 * Returns the popup element and a keydown handler that returns true when it used the key.
 */
export function useQuickReplyPopup({ client, text, name, onInsert }) {
  const replies = useQuickReplies(client);
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState(null); // the text Esc was pressed on
  const m = /^\/(\S*)$/.exec(text);
  const term = m ? fold(m[1]) : null;

  const matches = useMemo(() => {
    if (term === null) return [];
    return replies
      .map((r) => ({ r, s: Math.min(fuzzyScore(r.shortcut, term), fuzzyScore(r.text, term) + 2) }))
      .filter((x) => x.s < Infinity)
      .sort((a, b) => a.s - b.s)
      .slice(0, 8)
      .map((x) => x.r);
  }, [replies, term]);

  useEffect(() => setSel(0), [term]);
  useEffect(() => { if (dismissed !== null && text !== dismissed) setDismissed(null); }, [text, dismissed]);

  // A bare "/" with nothing saved yet: offer to create one instead of an empty box.
  const showEmpty = text === '/' && replies.length === 0;
  const open = term !== null && dismissed !== text && (matches.length > 0 || showEmpty);

  const insert = (r) => onInsert(fillPlaceholders(r.text, { name }));

  const onKeyDown = (e) => {
    if (!open) return false;
    if (e.key === 'Escape') { e.preventDefault(); setDismissed(text); return true; }
    if (!matches.length) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % matches.length); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + matches.length) % matches.length); return true; }
    if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing)) {
      e.preventDefault();
      insert(matches[sel] || matches[0]);
      return true;
    }
    return false;
  };

  const element = open ? (
    <div className="qr-pop" role="listbox" onMouseDown={(e) => e.preventDefault()}>
      <div className="qr-head"><Svg d={P.bolt} size={13} />Quick replies</div>
      {matches.map((r, i) => (
        <button key={r.id} role="option" aria-selected={i === sel} className={`qr-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => insert(r)}>
          <span className="qr-short">/{r.shortcut}</span>
          <span className="qr-text">{fillPlaceholders(r.text, { name })}</span>
          {i === sel && <kbd className="qr-kbd">Tab</kbd>}
        </button>
      ))}
      {showEmpty && <div className="qr-empty">No quick replies yet. Save the things you type all the time and insert them with /shortcut.</div>}
      <button className="qr-manage" onClick={() => emit('open-settings', 'quickreplies')}><Svg d={P.gear} size={13} />{showEmpty ? 'Create a quick reply' : 'Manage quick replies'}</button>
    </div>
  ) : null;

  return { element, onKeyDown, open };
}

function Editor({ initial, taken, onSave, onCancel }) {
  const [shortcut, setShortcut] = useState(initial?.shortcut || '');
  const [text, setText] = useState(initial?.text || '');
  const textRef = useRef(null);
  const clean = cleanShortcut(shortcut);
  const dupe = clean && taken.includes(clean) && clean !== initial?.shortcut;
  const ok = clean && text.trim() && !dupe;
  const save = () => ok && onSave({ id: initial?.id || Math.random().toString(36).slice(2, 10), shortcut: clean, text: text.trim() });
  const addPlaceholder = (p) => {
    const el = textRef.current;
    const at = el?.selectionStart ?? text.length;
    const next = text.slice(0, at) + p + text.slice(el?.selectionEnd ?? at);
    setText(next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + p.length, at + p.length); });
  };
  return (
    <div className="qr-editor" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
      <label className="qr-field">
        <span>Shortcut</span>
        <div className={`qr-short-input ${dupe ? 'bad' : ''}`}>
          <b>/</b>
          <input value={shortcut} onChange={(e) => setShortcut(e.target.value.replace(/^\/+/, ''))} placeholder="thanks" autoFocus spellCheck={false} />
        </div>
        {dupe && <em>There’s already a reply with this shortcut.</em>}
      </label>
      <label className="qr-field">
        <span>Text</span>
        <textarea ref={textRef} value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Hi {name}! Thanks for your message, I’ll get back to you shortly." />
      </label>
      <div className="qr-ph">
        {PLACEHOLDERS.map(([p, hint]) => <button key={p} onClick={() => addPlaceholder(p)} title={hint}>{p}</button>)}
        <span className="muted small">insert the person’s first name and a greeting for the time of day</span>
      </div>
      <div className="qr-editor-actions">
        <button className="sched-ghost" onClick={onCancel}>Cancel</button>
        <button className="sched-primary" disabled={!ok} onClick={save} title={`Save (${combo('Enter')})`}>Save</button>
      </div>
    </div>
  );
}

/** Settings → Quick replies. */
export function QuickRepliesPane({ client }) {
  const replies = useQuickReplies(client);
  const [editing, setEditing] = useState(null); // null | 'new' | id
  const [error, setError] = useState(null);
  const persist = async (next) => {
    setError(null);
    try { await saveQuickReplies(client, next); setEditing(null); }
    catch (err) { setError(`Couldn’t save: ${err.message}`); }
  };
  const taken = replies.map((r) => r.shortcut);
  return (
    <>
      <h2 className="pane-title">Quick replies</h2>
      <p className="pane-lead">Type <kbd>/</kbd> at the start of a message to pick a saved reply; <kbd>Tab</kbd> or <kbd>Enter</kbd> inserts it. They’re stored in your account, so they show up on all your devices.</p>
      {error && <div className="sched-error">{error}</div>}
      <section className="group">
        <div className="group-body qr-list">
          {replies.map((r) => (editing === r.id ? (
            <Editor key={r.id} initial={r} taken={taken} onCancel={() => setEditing(null)} onSave={(v) => persist(replies.map((x) => (x.id === r.id ? v : x)))} />
          ) : (
            <div key={r.id} className="qr-row">
              <span className="qr-short">/{r.shortcut}</span>
              <span className="qr-row-text">{r.text}</span>
              <div className="sched-actions">
                <button title="Edit" onClick={() => setEditing(r.id)}><Svg d={P.edit} size={15} /></button>
                <button title="Delete" className="danger" onClick={() => { if (confirm(`Delete /${r.shortcut}?`)) persist(replies.filter((x) => x.id !== r.id)); }}><Svg d={P.trash} size={15} /></button>
              </div>
            </div>
          )))}
          {editing === 'new'
            ? <Editor taken={taken} onCancel={() => setEditing(null)} onSave={(v) => persist([...replies, v])} />
            : (
              <button className="qr-add" onClick={() => setEditing('new')}>
                <span className="qr-add-icon"><Svg d={P.plus} size={16} /></span>New quick reply
              </button>
            )}
        </div>
      </section>
      {!replies.length && editing !== 'new' && (
        <div className="power-empty">
          <span className="power-empty-icon"><Svg d={P.bolt} size={26} /></span>
          <b>Reply in seconds</b>
          <span>Save greetings, addresses, links and the answers you send over and over.</span>
        </div>
      )}
    </>
  );
}

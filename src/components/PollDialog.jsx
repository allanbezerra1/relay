import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PollIcon } from './PollCard.jsx';
import { POLL_MAX_OPTIONS, POLL_OPTION_MAX, sendPoll } from '../whatsapp-power.js';

/** "Poll" from the composer's + menu: a question, 2–12 options, single or multiple choice. */
export default function PollDialog({ client, room, roomName, onClose, onSent }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const refs = useRef([]);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const lower = filled.map((o) => o.toLowerCase());
  const dupes = new Set(lower.filter((o, i) => lower.indexOf(o) !== i));
  const ready = question.trim() && filled.length >= 2 && !dupes.size && !sending;

  const setOption = (i, value) => {
    setOptions((list) => {
      const next = list.map((o, j) => (j === i ? value : o));
      // Always keep one empty row at the end (up to the limit), like WhatsApp.
      if (next[next.length - 1].trim() && next.length < POLL_MAX_OPTIONS) next.push('');
      return next;
    });
  };
  const removeOption = (i) => setOptions((list) => {
    const next = list.filter((_, j) => j !== i);
    while (next.length < 2) next.push('');
    if (next[next.length - 1].trim() && next.length < POLL_MAX_OPTIONS) next.push('');
    return next;
  });
  const onOptionKey = (e, i) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && ready) send();
      else refs.current[i + 1]?.focus();
    } else if (e.key === 'Backspace' && !options[i] && options.length > 2) {
      e.preventDefault();
      removeOption(i);
      refs.current[Math.max(0, i - 1)]?.focus();
    }
  };

  const send = async () => {
    if (!ready) return;
    setSending(true);
    setError(null);
    try {
      await sendPoll(client, room.roomId, { question: question.trim(), options: filled, multiple });
      onSent?.();
      onClose();
    } catch (err) {
      setError(err.message);
      setSending(false);
    }
  };

  return createPortal(
    <div className="overlay wa-overlay" onMouseDown={onClose}>
      <div className="dialog wa-dialog poll-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div className="wa-title">
            <span className="wa-title-icon"><PollIcon size={18} /></span>
            <div>
              <h2>New poll</h2>
              {roomName && <p className="wa-sub">in {roomName}</p>}
            </div>
          </div>
          <button className="wa-x" onClick={onClose} title="Close (Esc)">✕</button>
        </header>

        <label className="pd-label" htmlFor="pd-q">Question</label>
        <textarea id="pd-q" className="pd-question" autoFocus rows={2} maxLength={255} value={question}
          placeholder="Ask a question"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); refs.current[0]?.focus(); } }} />

        <div className="pd-label pd-label-row">
          <span>Options</span>
          <span className="pd-count">{filled.length}/{POLL_MAX_OPTIONS}</span>
        </div>
        <div className="pd-options">
          {options.map((o, i) => {
            const dupe = o.trim() && dupes.has(o.trim().toLowerCase());
            const isLastEmpty = i === options.length - 1 && !o.trim() && options.length > 2;
            return (
              <div key={i} className={`pd-option ${dupe ? 'dupe' : ''}`}>
                <span className={`pd-bullet ${multiple ? 'square' : ''}`} />
                <input ref={(el) => { refs.current[i] = el; }} value={o} maxLength={POLL_OPTION_MAX}
                  placeholder={isLastEmpty ? 'Add an option' : `Option ${i + 1}`}
                  onChange={(e) => setOption(i, e.target.value)} onKeyDown={(e) => onOptionKey(e, i)} />
                {o.length > POLL_OPTION_MAX - 15 && <span className="pd-chars">{POLL_OPTION_MAX - o.length}</span>}
                {options.length > 2 && !isLastEmpty && (
                  <button className="pd-remove" title="Remove option" tabIndex={-1} onClick={() => removeOption(i)}>
                    <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z" /></svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {dupes.size > 0 && <div className="pd-hint warn">Options must be different from each other.</div>}

        <button className={`pd-toggle ${multiple ? 'on' : ''}`} role="switch" aria-checked={multiple} onClick={() => setMultiple(!multiple)}>
          <span className="pd-toggle-text">
            <b>Allow multiple answers</b>
            <small>{multiple ? 'People can pick more than one option' : 'People pick a single option'}</small>
          </span>
          <span className="wa-switch"><i /></span>
        </button>

        {error && <div className="error">{error}</div>}
        <div className="wa-foot">
          <button className="wa-btn" onClick={onClose}>Cancel</button>
          <button className="wa-btn accent" disabled={!ready} onClick={send}>{sending ? 'Sending…' : 'Send poll'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

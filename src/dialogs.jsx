// Relay's own confirm/alert dialogs, in place of the browser's grey window.confirm/alert.
//
//   if (!(await ask({ title: 'Delete chat?', body: '…', ok: 'Delete', danger: true }))) return;
//   notice('Couldn’t save.');
//
// <DialogHost/> (mounted once in main.jsx) shows them one at a time.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const queue = [];
let notify = () => {};

function open(opts) {
  return new Promise((resolve) => { queue.push({ ...opts, resolve, key: Math.random() }); notify(); });
}

const asOpts = (x) => (typeof x === 'string' ? { body: x } : x || {});

/**
 * Asks for confirmation; resolves true/false.
 * { title, body, ok = 'Confirm', cancel = 'Cancel', danger, icon: 'trash'|'leave'|'warn'|'info'|'check', list: [names] }
 */
export const ask = (x) => open({ kind: 'ask', ...asOpts(x) });

/** Just tells something (errors, mostly); resolves when dismissed. */
export const notice = (x) => open({ kind: 'notice', icon: 'warn', ok: 'Ok', ...asOpts(x) });

const ICONS = {
  trash: 'M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9Zm4 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z',
  leave: 'M10 17v-3H3v-4h7V7l5 5-5 5Zm9-14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7v-2h7V5h-7V3h7Z',
  warn: 'M1 21 12 2l11 19H1Zm12-3v-2h-2v2h2Zm0-4V9h-2v5h2Z',
  info: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm1 15v-6h-2v6h2Zm0-8V7h-2v2h2Z',
  check: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm-1.5 14.5 7-7-1.4-1.4-5.6 5.6-2.6-2.6L6.5 12.5l4 4Z',
};

function Dialog({ d, onDone }) {
  const okRef = useRef(null);
  const cancelRef = useRef(null);
  const [leaving, setLeaving] = useState(false);
  const icon = d.icon || (d.danger ? 'trash' : d.kind === 'notice' ? 'warn' : 'info');
  const close = (v) => { if (leaving) return; setLeaving(true); setTimeout(() => onDone(v), 140); };

  // Destructive actions start on "Cancel", so a stray Enter doesn't delete anything.
  useEffect(() => { (d.danger && cancelRef.current ? cancelRef : okRef).current?.focus(); }, []);

  useEffect(() => {
    const doc = okRef.current?.ownerDocument || document;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(doc.activeElement !== cancelRef.current); }
    };
    doc.addEventListener('keydown', onKey, true);
    return () => doc.removeEventListener('keydown', onKey, true);
  });

  return (
    <div className={`adlg-backdrop${leaving ? ' out' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className={`adlg${d.danger ? ' danger' : ''}${leaving ? ' out' : ''}`} role="alertdialog" aria-modal="true">
        <div className={`adlg-icon i-${icon}`}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d={ICONS[icon] || ICONS.info} /></svg>
        </div>
        {d.title && <h3 className="adlg-title">{d.title}</h3>}
        {d.body && <p className="adlg-body">{d.body}</p>}
        {d.list?.length > 0 && (
          <ul className="adlg-list">
            {d.list.slice(0, 8).map((n, i) => <li key={i}>{n}</li>)}
            {d.list.length > 8 && <li className="more">and {d.list.length - 8} more</li>}
          </ul>
        )}
        <div className="adlg-actions">
          {d.kind === 'ask' && <button ref={cancelRef} className="adlg-btn ghost" onClick={() => close(false)}>{d.cancel || 'Cancel'}</button>}
          <button ref={okRef} className={`adlg-btn ${d.danger ? 'adlg-danger' : 'adlg-ok'}`} onClick={() => close(true)}>{d.ok || 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}

export function DialogHost() {
  const [, force] = useState(0);
  useEffect(() => { notify = () => force((n) => n + 1); return () => { notify = () => {}; }; }, []);
  const d = queue[0];
  if (!d) return null;
  const done = (v) => { queue.shift(); d.resolve(d.kind === 'ask' ? !!v : undefined); notify(); };
  return createPortal(<Dialog key={d.key} d={d} onDone={done} />, document.body);
}

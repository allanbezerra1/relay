// A search result that isn't in the chat's loaded history (too far back, or behind a gap left by
// a "limited" sync): show it with the messages around it, fetched with /context, in the same
// floating panel the reply threads use.
import { useEffect, useRef } from 'react';
import Message from './Message.jsx';

export default function JumpContext({ events, targetId, messageProps, onClose }) {
  const listRef = useRef(null);
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-event-id="${CSS.escape(targetId)}"]`);
    el?.scrollIntoView({ block: 'center' });
    el?.classList.add('flash');
  }, [targetId]);
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="thread-focus" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="thread-panel">
        <div className="thread-head">
          <span>Found message · with the messages around it</span>
          <button onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="thread-list" ref={listRef}>
          {events.map((ev) => (
            <Message key={ev.getId()} {...messageProps(ev)} showSender continued={false} onOpenThread={undefined}
              className={ev.getId() === targetId ? 'thread-target' : ''} />
          ))}
        </div>
      </div>
    </div>
  );
}

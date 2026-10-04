// Ask Relay: a question box, the local AI's answer with [n] citations, and the stretches of
// conversation it came from. Each source opens the chat at that message.
import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Avatar from './Avatar.jsx';
import { roomAvatar, cleanName } from '../matrix.js';
import { askRelay, bestLine, fallbackText, updateIndex, useAskStatus } from '../ask.js';

const ASK = 'M11 2a9 9 0 0 1 7.1 14.53l3.69 3.68-1.42 1.42-3.68-3.69A9 9 0 1 1 11 2Zm0 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 2 .95 2.55L14.5 9.5l-2.55.95L11 13l-.95-2.55L7.5 9.5l2.55-.95L11 6Z';
export const AskIcon = ({ size = 17 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={ASK} /></svg>;

const EXAMPLES = [
  'What address did someone send me this week?',
  'What did we decide about the trip?',
  'Who asked me for a quote?',
  'When is the birthday someone mentioned?',
];

const day = (ts) => {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
};

/** **bold** → <b>, the rest as text. */
const bold = (text, key) => text.split(/\*\*(.+?)\*\*/g).map((t, i) => (i % 2 ? <b key={`${key}-${i}`}>{t}</b> : <Fragment key={`${key}-${i}`}>{t}</Fragment>));

/** The answer, with [n] as little buttons that scroll to source n. */
function Answer({ text, streaming, onCite, count }) {
  const paras = text.split(/\n{2,}|\n(?=[-•*] )/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className={`ask-answer ${streaming ? 'streaming' : ''}`}>
      {paras.map((p, i) => (
        <p key={i}>
          {p.replace(/^[-•*]\s+/, '').split(/(\[\d+(?:\s*,\s*\d+)*\])/g).map((part, j) => {
            const m = /^\[(\d+(?:\s*,\s*\d+)*)\]$/.exec(part);
            if (!m) return <Fragment key={j}>{bold(part, j)}</Fragment>;
            return m[1].split(',').map((n) => +n.trim()).filter((n) => n >= 1 && n <= count)
              .map((n) => <button key={`${j}-${n}`} className="ask-cite" onClick={() => onCite(n)} title={`Source ${n}`}>{n}</button>);
          })}
          {streaming && i === paras.length - 1 && <span className="ai-caret" />}
        </p>
      ))}
    </div>
  );
}

function IndexStatus({ st, client }) {
  if (!st) return <div className="ask-index" />;
  const reading = st.reading;
  const busy = st.busy;
  const pct = busy?.total ? Math.min(100, Math.round((busy.done / busy.total) * 100))
    : reading?.total ? Math.min(100, Math.round((reading.done / reading.total) * 100)) : null;
  const rebuild = () => updateIndex(client).catch(() => {});
  if (reading || busy) {
    return (
      <div className="ask-index">
        <span className="ask-index-dot busy" />
        <span>{reading ? `Reading your chats… ${reading.done} of ${reading.total}` : `Indexing ${busy.done.toLocaleString()} of ${busy.total.toLocaleString()}`}</span>
        {pct != null && <i className="ask-bar"><b style={{ width: `${pct}%` }} /></i>}
      </div>
    );
  }
  if (!st.ready) {
    return (
      <div className="ask-index">
        <span className="ask-index-dot off" />
        <span>Relay hasn’t read your chats yet.</span>
        <button onClick={rebuild}>Build now</button>
      </div>
    );
  }
  const semantic = st.embedded > 0 && st.embedded >= st.chunks * 0.9;
  return (
    <div className="ask-index">
      <span className={`ask-index-dot ${semantic ? '' : 'warn'}`} />
      <span title={semantic ? 'Search by meaning' : 'Keyword search'}>
        {st.messages.toLocaleString()} messages from {st.rooms} {st.rooms === 1 ? 'chat' : 'chats'}{semantic ? '' : ' · keywords only'}
      </span>
      <button onClick={rebuild}>Update</button>
    </div>
  );
}

export default function AskPanel({ client, initial, onJump, onClose }) {
  const [q, setQ] = useState(initial || '');
  const [asked, setAsked] = useState(null);
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState([]);
  const [note, setNote] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | searching | answering | done | error
  const [error, setError] = useState(null);
  const [allSources, setAllSources] = useState(false);
  const job = useRef(null);
  const input = useRef(null);
  const srcRefs = useRef({});
  const st = useAskStatus();

  const run = (question) => {
    const text = (question ?? q).trim();
    if (!text) return;
    job.current?.cancel();
    setQ(text); setAsked(text); setAnswer(''); setSources([]); setNote(null); setError(null); setAllSources(false); setPhase('searching');
    // Catch up on messages that arrived since the last pass first (quick when little changed).
    const fresh = Promise.race([updateIndex(client).catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
    const mine = askRelay(text, {
      before: fresh,
      onSources: (s, info) => { setSources(s); setNote(fallbackText(info?.note)); setPhase(s.length ? 'answering' : 'done'); },
      onText: (t) => setAnswer(t),
    });
    job.current = mine;
    mine.done.then((res) => {
      if (job.current !== mine || res.error === 'cancelled') return;
      if (!res.ok) { setError(res.error); setPhase('error'); return; }
      setAnswer(res.text); setPhase('done');
    });
  };
  useEffect(() => {
    if (initial) run(initial); else input.current?.focus();
    return () => job.current?.cancel();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Once answered, the sources it cites come first; the rest wait behind "Show N more".
  const cited = new Set([...answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)].flatMap((m) => m[1].split(',').map((n) => +n.trim())));
  const showAll = allSources || phase !== 'done' || !cited.size;
  const shown = sources.map((s, i) => ({ s, n: i + 1 })).filter(({ n }) => showAll || cited.has(n));
  const hidden = sources.length - shown.length;

  const cite = (n) => {
    if (!allSources && !cited.has(n)) setAllSources(true);
    requestAnimationFrame(() => {
      const el = srcRefs.current[n];
      if (!el) return;
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    });
  };

  return createPortal(
    <div className="ask-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ask-panel" role="dialog" aria-label="Ask Relay">
        <form className="ask-box" onSubmit={(e) => { e.preventDefault(); run(); }}>
          <span className={`ask-orb ${phase === 'searching' || phase === 'answering' ? 'busy' : ''}`}><AskIcon size={20} /></span>
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything about your chats…" spellCheck={false} />
          {q.trim() && <button type="submit" className="ask-go" title="Ask (Return)" aria-label="Ask">↵</button>}
        </form>

        <div className="ask-body">
          {!asked && (
            <div className="ask-intro">
              <b>Ask Relay</b>
              <p>Searches all your chats by meaning, then answers with your local AI and shows where it found it. Everything stays on this computer and your own LM Studio.</p>
              <div className="ask-examples">
                {EXAMPLES.map((x) => <button key={x} type="button" onClick={() => run(x)}>{x}</button>)}
              </div>
            </div>
          )}

          {asked && (
            <section className="ask-result">
              {phase === 'searching' && <div className="ask-thinking"><span className="ask-spin" />Searching your chats…</div>}
              {phase === 'error' && <div className="ai-error">{error}</div>}
              {phase !== 'error' && (answer ? <Answer text={answer} streaming={phase === 'answering'} onCite={cite} count={sources.length} />
                : phase === 'answering' && <div className="ask-thinking"><span className="ask-spin" />Reading {sources.length} {sources.length === 1 ? 'excerpt' : 'excerpts'}…</div>)}
              {phase === 'done' && !sources.length && (
                <div className="ask-empty">{st?.ready ? 'Nothing about that in your chats.' : 'Relay hasn’t read your chats yet. Build the index below, then ask again.'}</div>
              )}
              {note && sources.length > 0 && <div className="ask-note">{note}</div>}

              {sources.length > 0 && (
                <div className="ask-sources">
                  <h3>Sources</h3>
                  {shown.map(({ s, n }) => {
                    const room = client.getRoom(s.roomId);
                    const best = bestLine(s, asked);
                    const lines = s.text.split('\n');
                    const from = Math.max(0, Math.min(best.index - 1, lines.length - 3));
                    return (
                      <button key={s.id} type="button" ref={(el) => { srcRefs.current[n] = el; }} className="ask-src"
                        onClick={() => room && onJump(s.roomId, best.eventId)} disabled={!room}
                        title={room ? 'Open the chat at this message' : 'You’re no longer in this chat'}>
                        <span className="ask-src-n">{n}</span>
                        <span className="ask-src-main">
                          <span className="ask-src-head">
                            {room && <Avatar src={roomAvatar(client, room, 48)} name={s.room} id={s.roomId} size={20} />}
                            <b>{cleanName(room?.name || s.room)}</b>
                            <small>{day(s.ts)}{new Date(s.end).toDateString() !== new Date(s.ts).toDateString() ? ` – ${day(s.end)}` : ''}</small>
                          </span>
                          {lines.slice(from, from + 3).map((l, j) => (
                            <span key={j} className={`ask-line ${from + j === best.index ? 'hit' : ''}`}>{l.replace(/^\[[^\]]+\]\s*/, '')}</span>
                          ))}
                        </span>
                      </button>
                    );
                  })}
                  {hidden > 0 && <button type="button" className="ask-more" onClick={() => setAllSources(true)}>Show {hidden} more {hidden === 1 ? 'source' : 'sources'}</button>}
                </div>
              )}
            </section>
          )}
        </div>
        <footer className="ask-foot">
          <IndexStatus st={st} client={client} />
          <span className="ask-kbd"><kbd>esc</kbd> to close</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

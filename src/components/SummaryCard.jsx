// "What did I miss?": a card at the top of the chat that streams a summary of the
// unread messages from the local AI (LM Studio).
import { Fragment, useEffect, useRef, useState } from 'react';
import { usePrefs } from '../prefs.js';
import { aiPrefs, useAiReady, gatherMessages, summaryPrompt, streamChat, shortModel } from '../ai.js';

const SPARK = 'M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2Zm7 11 .95 2.55L22.5 16.5l-2.55.95L19 20l-.95-2.55-2.55-.95 2.55-.95L19 13ZM5 15l.7 1.8 1.8.7-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7L5 15Z';
export const SPARK_PATH = SPARK;
export const Spark = ({ size = 15 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={SPARK} /></svg>;

// ---------- Tiny Markdown: **bold**, *italic*, `code`, links, bullets, headings ----------

function inline(text, key = '') {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|(https?:\/\/[^\s)]+))/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${m.index}`;
    if (m[2]) out.push(<b key={k}>{m[2]}</b>);
    else if (m[3]) out.push(<i key={k}>{m[3]}</i>);
    else if (m[4]) out.push(<code key={k}>{m[4]}</code>);
    else if (m[5]) out.push(<a key={k} href={m[5]} target="_blank" rel="noreferrer">{m[5].replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function AiText({ text, streaming }) {
  const blocks = [];
  let list = null;
  text.split('\n').forEach((raw) => {
    const line = raw.trimEnd();
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) { list = []; blocks.push({ list }); }
      list.push(bullet[1]);
      return;
    }
    list = null;
    if (!line.trim()) return;
    const heading = /^(?:#{1,4}\s*)?\*\*(.+?)\*\*:?\s*$/.exec(line) || /^#{1,4}\s+(.+)$/.exec(line);
    blocks.push(heading ? { h: heading[1].replace(/:$/, '') } : { p: line });
  });
  return (
    <div className={`ai-text ${streaming ? 'streaming' : ''}`}>
      {blocks.map((b, i) => (
        <Fragment key={i}>
          {b.h && <h4>{inline(b.h, i)}</h4>}
          {b.p && <p>{inline(b.p, i)}</p>}
          {b.list && <ul>{b.list.map((li, j) => <li key={j}>{inline(li, `${i}-${j}`)}</li>)}</ul>}
        </Fragment>
      ))}
      {streaming && <span className="ai-caret" />}
    </div>
  );
}

// ---------- Header button ----------

/** "Summarize" in the chat header: a pill with the count when there's a lot unread, a small icon otherwise. */
export function SummarizeButton({ info, open, onClick }) {
  const p = aiPrefs(usePrefs());
  const ready = useAiReady();
  if (!ready || info.invite) return null;
  const many = info.unread >= p.aiThreshold;
  return (
    <button className={`ai-sum-btn ${many ? 'big' : ''} ${open ? 'on' : ''}`} onClick={onClick}
      title={many ? `Summarize the ${info.unread} unread messages` : 'Summarize this chat with your local AI'}>
      <Spark size={many ? 15 : 17} />
      {many && <span>Summarize <b>{info.unread > 999 ? '999+' : info.unread}</b></span>}
    </button>
  );
}

/** Opens the card when something (the chat list menu) asks for this room's summary. */
export function useSummaryRequest(roomId, open) {
  useEffect(() => {
    const on = (e) => { if (e.detail?.roomId === roomId) open(); };
    window.addEventListener('relay:summarize', on);
    return () => window.removeEventListener('relay:summarize', on);
  }, [roomId, open]);
}

// ---------- Card ----------

export default function SummaryCard({ client, room, onClose }) {
  const [expand, setExpand] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ phase: 'gathering', text: '', meta: null, error: null });
  const [model, setModel] = useState(() => aiPrefs().aiModel);
  const [copied, setCopied] = useState(false);
  const job = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'gathering', text: '', meta: null, error: null });
    (async () => {
      const convo = await gatherMessages(client, room, { expand });
      if (cancelled) return;
      if (!convo.count) { setState({ phase: 'error', text: '', meta: convo, error: 'There are no text messages to summarize here.' }); return; }
      setState((s) => ({ ...s, phase: 'thinking', meta: convo }));
      job.current = streamChat({
        messages: summaryPrompt(client, room, convo),
        temperature: 0.2,
        onModel: (m) => !cancelled && setModel(m),
        onText: (text) => !cancelled && setState((s) => ({ ...s, phase: 'streaming', text })),
      });
      const res = await job.current.done;
      if (cancelled) return;
      setState((s) => ({ ...s, phase: res.ok ? 'done' : 'error', text: res.text || s.text, error: res.ok ? null : res.error }));
    })().catch((err) => !cancelled && setState((s) => ({ ...s, phase: 'error', error: String(err.message || err) })));
    return () => { cancelled = true; job.current?.cancel(); };
  }, [client, room, expand, attempt]);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const { phase, text, meta, error } = state;
  const busy = phase === 'gathering' || phase === 'thinking' || phase === 'streaming';
  const since = meta?.from ? new Date(meta.from).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  const sinceDay = meta?.from && new Date(meta.from).toDateString() !== new Date().toDateString()
    ? new Date(meta.from).toLocaleDateString([], { day: 'numeric', month: 'short' }) : null;
  const what = meta
    ? `${meta.count} ${meta.mode === 'unread' && !expand ? 'unread ' : ''}message${meta.count === 1 ? '' : 's'}${since ? ` · since ${sinceDay ? `${sinceDay}, ` : ''}${since}` : ''}${meta.truncated ? ' · trimmed to fit' : ''}`
    : 'Reading the messages…';

  const copy = () => {
    navigator.clipboard.writeText(`Summary of ${room.name}\n\n${text}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={`ai-card is-${phase}`} role="region" aria-label="Chat summary">
      <div className="ai-card-glow" />
      <header className="ai-card-head">
        <span className={`ai-orb ${busy ? 'busy' : ''}`}><Spark size={15} /></span>
        <div className="ai-card-title">
          <b>What you missed</b>
          <small>{what}</small>
        </div>
        {model && <span className="ai-model" title={`Model in LM Studio: ${model}`}>{shortModel(model)}</span>}
        <button className="ai-x" onClick={onClose} title="Close (Esc)">✕</button>
      </header>
      <div className="ai-card-body">
        {(phase === 'gathering' || phase === 'thinking') && (
          <div className="ai-skeleton">
            <i style={{ width: '62%' }} /><i style={{ width: '88%' }} /><i style={{ width: '74%' }} />
            <span>{phase === 'gathering' ? 'Gathering the messages…' : 'Your local AI is reading…'}</span>
          </div>
        )}
        {text && <AiText text={text} streaming={phase === 'streaming'} />}
        {phase === 'error' && <div className="ai-error">{error}</div>}
      </div>
      <footer className="ai-card-foot">
        {busy ? (
          <button className="ai-btn" onClick={() => { job.current?.cancel(); setState((s) => ({ ...s, phase: 'done' })); }}>Stop</button>
        ) : (
          <>
            <button className="ai-btn" disabled={!text} onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
            {meta?.canExpand !== false && expand < 4 && <button className="ai-btn" onClick={() => setExpand((n) => n + 1)}>Summarize more</button>}
            {phase === 'error' && meta?.count > 0 && <button className="ai-btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>}
          </>
        )}
        <span className="ai-spacer" />
        <button className="ai-btn primary-ish" onClick={onClose}>Done</button>
      </footer>
    </div>
  );
}

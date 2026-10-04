// Daily digest: the busiest unread groups, summarized one after another
// (one at a time, so LM Studio isn't asked to juggle several prompts).
import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import { AiText, Spark } from './SummaryCard.jsx';
import { roomAvatar } from '../matrix.js';
import { aiPrefs, gatherMessages, digestPrompt, streamChat, shortModel } from '../ai.js';

const MAX_GROUPS = 6;

export function pickGroups(rooms) {
  const unread = (r) => r.unread || (r.markedUnread ? 1 : 0);
  const groups = rooms.filter((r) => r.group && !r.invite && !r.archived && unread(r) > 0).sort((a, b) => unread(b) - unread(a));
  // Muted groups only fill in when there's little else going on.
  const loud = groups.filter((r) => !r.muted);
  return (loud.length >= 3 ? loud : [...loud, ...groups.filter((r) => r.muted)]).slice(0, MAX_GROUPS);
}

/** Summarizes the given groups one by one. Also used inline by the morning briefing. */
export function useDigest(client, items) {
  const [state, setState] = useState(() => Object.fromEntries(items.map((it) => [it.r.id, { phase: 'waiting', text: '', error: null }])));
  const [model, setModel] = useState(() => aiPrefs().aiModel);
  const job = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const set = (id, patch) => !cancelled && setState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
    (async () => {
      for (const { r } of items) {
        if (cancelled) return;
        set(r.id, { phase: 'thinking' });
        try {
          const convo = await gatherMessages(client, r.room);
          if (cancelled) return;
          if (!convo.count) { set(r.id, { phase: 'error', error: 'No text messages to summarize.' }); continue; }
          // Keep each group short: the digest is a skim, the chat card is the deep read.
          const trimmed = convo.text.length > 6000 ? { ...convo, text: convo.text.slice(-6000), truncated: true } : convo;
          job.current = streamChat({
            messages: digestPrompt(client, r.room, trimmed), maxTokens: 400,
            onModel: (m) => !cancelled && setModel(m),
            onText: (text) => set(r.id, { phase: 'streaming', text }),
          });
          const res = await job.current.done;
          if (cancelled) return;
          set(r.id, res.ok ? { phase: 'done', text: res.text } : { phase: 'error', error: res.error, text: res.text });
          // LM Studio isn't there: don't try every group just to fail the same way.
          if (!res.ok && /Couldn’t reach|has no models/.test(res.error)) {
            items.slice(items.findIndex((x) => x.r.id === r.id) + 1).forEach((x) => set(x.r.id, { phase: 'skipped' }));
            return;
          }
        } catch (err) {
          set(r.id, { phase: 'error', error: String(err.message || err) });
        }
      }
    })();
    return () => { cancelled = true; job.current?.cancel(); };
  }, [client, items]);

  const doneCount = items.filter((it) => ['done', 'error', 'skipped'].includes(state[it.r.id].phase)).length;
  return { state, model, doneCount };
}

export function DigestItems({ client, items, state, onOpen }) {
  return items.map(({ r }, i) => {
    const st = state[r.id];
    return (
      <article key={r.id} className={`digest-item is-${st.phase}`} style={{ '--i': i }}>
        <div className="digest-item-head">
          <Avatar src={roomAvatar(client, r.room, 72)} name={r.name} id={r.id} size={32} network={r.network} account={r.account} />
          <div className="digest-item-title">
            <b>{r.name}</b>
            <small>{r.unread ? `${r.unread} unread` : 'marked as unread'}{r.highlight ? ' · mentions you' : ''}</small>
          </div>
          <button className="ai-btn" onClick={() => onOpen(r.id)}>Open</button>
        </div>
        <div className="digest-item-body">
          {st.phase === 'waiting' && <span className="digest-wait">Waiting…</span>}
          {st.phase === 'skipped' && <span className="digest-wait">Skipped</span>}
          {st.phase === 'thinking' && <div className="ai-skeleton small"><i style={{ width: '70%' }} /><i style={{ width: '50%' }} /></div>}
          {st.text && <AiText text={st.text} streaming={st.phase === 'streaming'} />}
          {st.phase === 'error' && <div className="ai-error">{st.error}</div>}
        </div>
      </article>
    );
  });
}

export default function DigestPanel({ client, rooms, onOpen, onClose }) {
  const [items] = useState(() => pickGroups(rooms).map((r) => ({ r })));
  const { state, model, doneCount } = useDigest(client, items);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const today = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="overlay digest-overlay" onMouseDown={onClose}>
      <div className="digest" onMouseDown={(e) => e.stopPropagation()}>
        <header className="digest-head">
          <span className={`ai-orb big ${doneCount < items.length ? 'busy' : ''}`}><Spark size={20} /></span>
          <div>
            <h2>Daily digest</h2>
            <small>
              {today} · {items.length ? `${doneCount} of ${items.length} groups` : 'no groups with new messages'}
              {model ? ` · ${shortModel(model)}` : ''}
            </small>
          </div>
          <button className="ai-x" onClick={onClose} title="Close (Esc)">✕</button>
        </header>
        {items.length > 0 && <div className="digest-progress"><i style={{ width: `${(doneCount / items.length) * 100}%` }} /></div>}
        <div className="digest-list">
          {items.length === 0 && <div className="digest-empty">All caught up<br /><small>None of your groups have unread messages right now.</small></div>}
          <DigestItems client={client} items={items} state={state} onOpen={onOpen} />
        </div>
      </div>
    </div>
  );
}

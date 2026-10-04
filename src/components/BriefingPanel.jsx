// "Good morning": today's briefing (src/briefing.js) as a panel. The write-up on top (by the
// local AI, or plain when it isn't running), then the chats waiting on you, the plans coming up,
// what you're waiting on, and the busiest groups, which the daily digest can summarize in place.
import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import { AiText } from './SummaryCard.jsx';
import { DigestItems, pickGroups, useDigest } from './DigestPanel.jsx';
import { roomAvatar } from '../matrix.js';
import { makeBriefing, lastBriefing, agendaWhen, gatherFacts } from '../briefing.js';
import { ago } from '../triage.js';
import { shortModel } from '../ai.js';

const SUN = 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM2 13h2a1 1 0 0 0 0-2H2a1 1 0 0 0 0 2Zm18 0h2a1 1 0 0 0 0-2h-2a1 1 0 0 0 0 2ZM11 2v2a1 1 0 0 0 2 0V2a1 1 0 0 0-2 0Zm0 18v2a1 1 0 0 0 2 0v-2a1 1 0 0 0-2 0ZM5.99 4.58a1 1 0 0 0-1.41 1.41l1.06 1.06a1 1 0 0 0 1.41-1.41L5.99 4.58Zm12.37 12.37a1 1 0 0 0-1.41 1.41l1.06 1.06a1 1 0 0 0 1.41-1.41l-1.06-1.06Zm1.06-10.96a1 1 0 0 0-1.41-1.41l-1.06 1.06a1 1 0 0 0 1.41 1.41l1.06-1.06ZM7.05 18.36a1 1 0 0 0-1.41-1.41l-1.06 1.06a1 1 0 0 0 1.41 1.41l1.06-1.06Z';
const REFRESH = 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z';
export const SunIcon = ({ size = 17 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={SUN} /></svg>;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** The daily digest, inline: summarizes the busiest groups one by one once it's mounted. */
function InlineDigest({ client, rooms, onOpen }) {
  const [items] = useState(() => pickGroups(rooms).map((r) => ({ r })));
  const { state, model, doneCount } = useDigest(client, items);
  if (!items.length) return <div className="bf-note">None of your groups have unread messages right now.</div>;
  return (
    <div className="bf-digest">
      <div className="bf-digest-meta">
        <span>{doneCount < items.length ? `Summarizing ${Math.min(doneCount + 1, items.length)} of ${items.length}…` : `${items.length} groups summarized`}</span>
        {model && <span className="ai-model">{shortModel(model)}</span>}
      </div>
      <DigestItems client={client} items={items} state={state} onOpen={onOpen} />
    </div>
  );
}

export default function BriefingPanel({ client, rooms, onOpen, onClose, canDigest }) {
  // This morning's write-up stays, but the lists under it are always current.
  const [b, setB] = useState(() => { const prev = lastBriefing(); return prev && { ...prev, facts: gatherFacts(client, rooms) }; });
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [digest, setDigest] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const run = async (force) => {
    setBusy(true);
    setStreaming('');
    const res = await makeBriefing(client, rooms, { force, onText: (t) => alive.current && setStreaming(t) });
    if (!alive.current) return;
    setB(res);
    setBusy(false);
    setStreaming('');
  };
  // Today's is already there (written this morning): show it. Otherwise write a fresh one.
  useEffect(() => {
    if (!b || new Date(b.at).toDateString() !== new Date().toDateString()) run(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const f = b?.facts;
  const rawName = client.getUser(client.getUserId())?.displayName || '';
  const name = rawName && rawName !== 'me' && !rawName.startsWith('@') ? rawName.split(' ')[0] : '';
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const roomOf = (id) => client.getRoom(id);
  const nothing = f && !f.reply.length && !f.agenda.length && !f.waiting.length && !f.busyGroups.length;

  return (
    <div className="overlay bf-overlay" onMouseDown={onClose}>
      <div className="bf-panel" role="dialog" aria-label={greeting()} onMouseDown={(e) => e.stopPropagation()}>
        <header className="bf-hero">
          <div className="bf-sun"><SunIcon size={26} /></div>
          <div className="bf-title">
            <h2>{greeting()}{name ? `, ${name}` : ''}</h2>
            <span>{date}</span>
          </div>
          <button className="bf-icon" title="Write it again" onClick={() => run(true)} disabled={busy}>
            <svg viewBox="0 0 24 24" width="17" height="17" className={busy ? 'spin' : ''}><path fill="currentColor" d={REFRESH} /></svg>
          </button>
          <button className="ai-x" title="Close (Esc)" onClick={onClose}>✕</button>
        </header>

        <div className="bf-body">
          <section className="bf-ai">
            {busy && !streaming
              ? <div className="ai-skeleton"><i style={{ width: '92%' }} /><i style={{ width: '78%' }} /><i style={{ width: '55%' }} /></div>
              : <AiText text={streaming || b?.text || ''} streaming={busy} />}
          </section>

          {f?.reply.length > 0 && (
            <section className="bf-sec">
              <h3><span className="bf-dot is-reply" />Waiting for you <small>{f.reply.length}</small></h3>
              {f.reply.map((x) => (
                <button key={x.id} className="bf-row" onClick={() => onOpen(x.id)}>
                  {roomOf(x.id) && <Avatar src={roomAvatar(client, roomOf(x.id), 64)} name={x.name} id={x.id} size={34} />}
                  <span className="bf-row-main"><b>{x.name}</b><span>{x.reason || `${x.who}: ${x.text}`}</span></span>
                  <small>{ago(x.since)}</small>
                </button>
              ))}
            </section>
          )}

          {f?.agenda.length > 0 && (
            <section className="bf-sec">
              <h3><span className="bf-dot is-agenda" />Coming up <small>{f.agenda.length}</small></h3>
              {f.agenda.map((a) => {
                const d = new Date(a.at);
                return (
                  <button key={`${a.id}${a.at}`} className="bf-row" onClick={() => onOpen(a.id)}>
                    <span className="bf-date"><b>{d.toLocaleDateString('en-US', { month: 'short' })}</b><span>{d.getDate()}</span></span>
                    <span className="bf-row-main"><b>{a.text}</b><span>{a.who} · {a.name}</span></span>
                    <small>{agendaWhen(a)}</small>
                  </button>
                );
              })}
            </section>
          )}

          {f?.waiting.length > 0 && (
            <section className="bf-sec">
              <h3><span className="bf-dot is-waiting" />You’re waiting on <small>{f.waiting.length}</small></h3>
              <div className="bf-chips">
                {f.waiting.map((x) => <button key={x.id} onClick={() => onOpen(x.id)} title={x.reason || x.text}>{x.name} <span>· {ago(x.since)}</span></button>)}
              </div>
            </section>
          )}

          {f && (f.busyGroups.length > 0 || digest) && (
            <section className="bf-sec">
              <h3>
                <span className="bf-dot is-groups" />Busy groups
                {canDigest && !digest && <button className="bf-link" onClick={() => setDigest(true)}>Catch up with AI</button>}
              </h3>
              {digest ? <InlineDigest client={client} rooms={rooms} onOpen={onOpen} /> : (
                <div className="bf-chips">
                  {f.busyGroups.map((x) => <button key={x.id} onClick={() => onOpen(x.id)}>{x.name} <span>· {x.unread} new</span></button>)}
                </div>
              )}
            </section>
          )}

          {nothing && !busy && <div className="bf-empty">Nothing waiting on you. Enjoy your day.</div>}
        </div>

        {b && !busy && (
          <footer className="bf-foot">
            {b.ai ? 'Written by your local AI' : 'Plain summary (local AI is off or didn’t answer)'} · {new Date(b.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </footer>
        )}
      </div>
    </div>
  );
}

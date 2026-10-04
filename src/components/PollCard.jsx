import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Avatar from './Avatar.jsx';
import { memberAvatar, senderName } from '../matrix.js';
import { pollTally, sendVote } from '../whatsapp-power.js';

export function PollIcon({ size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="3" y="4" width="13" height="3.2" rx="1.6" fill="currentColor" />
      <rect x="3" y="10.4" width="18" height="3.2" rx="1.6" fill="currentColor" opacity="0.75" />
      <rect x="3" y="16.8" width="8" height="3.2" rx="1.6" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** A poll in the timeline: options with live vote bars; click to vote or change your vote. */
export default function PollCard({ client, room, ev, poll, mine }) {
  const me = client.getUserId();
  const pollId = ev.getId();
  const sent = pollId && !ev.status && !pollId.startsWith('~');
  const tally = sent ? pollTally(room, poll, pollId, me) : { counts: new Map(), voters: new Map(), total: 0, people: 0, mine: [] };
  const [showVotes, setShowVotes] = useState(false);
  const [error, setError] = useState(null);
  const max = Math.max(1, ...tally.counts.values());

  const vote = async (id) => {
    if (!sent) return;
    let next;
    if (poll.multiple) next = tally.mine.includes(id) ? tally.mine.filter((a) => a !== id) : [...tally.mine, id];
    else next = tally.mine.includes(id) ? [] : [id];
    setError(null);
    try { await sendVote(client, room.roomId, pollId, next); }
    catch (err) { setError(`Couldn’t vote: ${err.message}`); }
  };

  return (
    <div className={`poll-card ${mine ? 'mine' : ''}`}>
      <div className="poll-head">
        <span className="poll-badge"><PollIcon size={13} />Poll</span>
        <span className="poll-kind">{poll.multiple ? 'Select one or more' : 'Select one'}</span>
      </div>
      <div className="poll-q">{poll.question}</div>
      <div className="poll-opts" role={poll.multiple ? 'group' : 'radiogroup'}>
        {poll.answers.map((a) => {
          const n = tally.counts.get(a.id) || 0;
          const picked = tally.mine.includes(a.id);
          const voters = tally.voters.get(a.id) || [];
          const pct = tally.people ? Math.round((n / tally.people) * 100) : 0;
          const names = voters.map((u) => (u === me ? 'You' : senderName(room, u)));
          return (
            <button key={a.id} className={`poll-opt ${picked ? 'picked' : ''} ${n && n === max ? 'lead' : ''}`}
              role={poll.multiple ? 'checkbox' : 'radio'} aria-checked={picked} disabled={!sent}
              title={names.length ? names.join(', ') : 'No votes yet'}
              onClick={(e) => { e.stopPropagation(); vote(a.id); }}>
              <span className={`poll-check ${poll.multiple ? 'square' : ''}`}>
                {picked && <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="m9.5 16.2-4.2-4.2-1.4 1.4 5.6 5.6 11-11-1.4-1.4z" /></svg>}
              </span>
              <span className="poll-main">
                <span className="poll-line">
                  <span className="poll-text">{a.text}</span>
                  {voters.length > 0 && (
                    <span className="poll-faces">
                      {voters.slice(0, 3).map((u) => (
                        <Avatar key={u} src={memberAvatar(client, room, u, 32)} name={senderName(room, u)} id={u} size={16} />
                      ))}
                    </span>
                  )}
                  <span className="poll-count">{n}</span>
                </span>
                <span className="poll-bar"><i style={{ width: `${pct}%` }} /></span>
              </span>
            </button>
          );
        })}
      </div>
      {error && <div className="poll-error">{error}</div>}
      <div className="poll-foot">
        <span>{tally.people ? plural(tally.people, 'person voted', 'people voted') : sent ? 'No votes yet' : 'Sending…'}</span>
        <button className="poll-see" disabled={!tally.people} onClick={(e) => { e.stopPropagation(); setShowVotes(true); }}>View votes</button>
      </div>
      {showVotes && <PollVotes client={client} room={room} poll={poll} tally={tally} me={me} onClose={() => setShowVotes(false)} />}
    </div>
  );
}

function PollVotes({ client, room, poll, tally, me, onClose }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const order = [...poll.answers].sort((a, b) => (tally.counts.get(b.id) || 0) - (tally.counts.get(a.id) || 0));
  return createPortal(
    <div className="overlay wa-overlay" onMouseDown={onClose}>
      <div className="dialog wa-dialog poll-votes" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h2>Poll votes</h2>
            <p className="wa-sub">{poll.question}</p>
          </div>
          <button className="wa-x" onClick={onClose} title="Close (Esc)">✕</button>
        </header>
        <div className="pv-list">
          {order.map((a) => {
            const voters = tally.voters.get(a.id) || [];
            return (
              <div key={a.id} className="pv-opt">
                <div className="pv-head">
                  <span className="pv-name">{a.text}</span>
                  <span className="pv-n">{plural(voters.length, 'vote', 'votes')}</span>
                </div>
                {voters.length ? voters.map((u) => (
                  <div key={u} className="pv-voter">
                    <Avatar src={memberAvatar(client, room, u, 48)} name={senderName(room, u)} id={u} size={28} />
                    <span>{u === me ? 'You' : senderName(room, u)}</span>
                  </div>
                )) : <div className="pv-empty">No votes</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

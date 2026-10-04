// The opening screen while Relay starts its local server and syncs: an aurora sky, the app icon
// with the networks orbiting it, the steps as they finish, and a rotating tip.
import { useEffect, useState } from 'react';
import iconUrl from '../../build/icon.svg?url';
import NetIcon from './NetIcon.jsx';

const ORBIT = ['whatsapp', 'instagram', 'telegram', 'signal', 'discord', 'messenger'];

const mod = navigator.platform?.startsWith('Mac') ? '⌘' : 'Ctrl+';
const TIPS = [
  `${mod}K jumps to any chat.`,
  'Drag photos onto a chat to send them.',
  `${mod}-click chats to select several at once.`,
  'Right-click a chat to pin, mute or archive it.',
  'Press Esc to close any dialog or panel.',
  'Settings → Appearance changes the accent color and theme.',
];

const STEPS = [
  { id: 'loading', label: 'Opening' },
  { id: 'starting-local', label: 'Local server' },
  { id: 'syncing', label: 'Chats' },
];

export default function Splash({ phase, isLocal, error, onRetry, onLogs }) {
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length));
  useEffect(() => {
    const t = setInterval(() => setTip((i) => (i + 1) % TIPS.length), 4200);
    return () => clearInterval(t);
  }, []);

  const failed = phase === 'local-error';
  const steps = isLocal || phase === 'starting-local' || failed ? STEPS : STEPS.filter((s) => s.id !== 'starting-local');
  const at = failed ? steps.findIndex((s) => s.id === 'starting-local') : Math.max(0, steps.findIndex((s) => s.id === phase));
  const pct = failed ? 50 : Math.round(((at + 0.6) / steps.length) * 100);
  const message = failed ? 'Your local chat server didn’t start.'
    : phase === 'starting-local' ? 'Starting your chat server…'
      : phase === 'syncing' ? 'Syncing your chats…' : 'Getting things ready…';

  return (
    <div className={`boot ${failed ? 'failed' : ''}`}>
      <div className="drag-region" />
      <div className="boot-sky" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="boot-stars" aria-hidden="true" />

      <div className="boot-center">
        <div className="boot-orbit" aria-hidden="true">
          {ORBIT.map((id, i) => (
            <span key={id} className="boot-planet" style={{ '--i': i, '--n': ORBIT.length }}>
              <span className="boot-planet-inner"><NetIcon id={id} size={30} variant="tile" /></span>
            </span>
          ))}
          <img className="boot-icon" src={iconUrl} alt="" draggable="false" />
        </div>

        <h1 className="boot-title">Relay</h1>
        <p className="boot-msg" aria-live="polite">{message}</p>

        {!failed && (
          <>
            <ol className="boot-steps">
              {steps.map((s, i) => (
                <li key={s.id} className={i < at ? 'done' : i === at ? 'on' : ''}>
                  <span className="boot-dot">{i < at && <svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" /></svg>}</span>
                  {s.label}
                </li>
              ))}
            </ol>
            <div className="boot-bar"><b style={{ width: `${pct}%` }} /></div>
            <p className="boot-tip" key={tip}><span>Tip</span>{TIPS[tip]}</p>
          </>
        )}

        {failed && (
          <div className="boot-error">
            {error && <div className="boot-error-text">{error}</div>}
            <div className="boot-actions">
              <button className="boot-btn ghost" onClick={onLogs}>Show logs</button>
              <button className="boot-btn" onClick={onRetry}>Try again</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

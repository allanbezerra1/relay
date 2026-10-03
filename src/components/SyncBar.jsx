import { useEffect, useRef, useState } from 'react';
import { networkInfo } from '../networks.js';
import { cleanName } from '../matrix.js';

/** What each syncing account is doing right now, in words and a 0–1 fraction (null = indeterminate). */
function describe(p) {
  const s = p.sync;
  const { total, ready } = s.chats;
  if (s.waitingForPhone) return { text: 'Waiting for your phone to send your chats. Keep WhatsApp open on it.', frac: null };
  if (s.history != null && s.history < 100) {
    return { text: 'Receiving your chat history from your phone', frac: s.history / 100 };
  }
  if (total > 0 && ready < total) return { text: `Setting up chats · ${ready} of ${total}`, frac: ready / total };
  return { text: 'Finishing up…', frac: null };
}

export default function SyncBar({ profiles }) {
  const syncing = profiles.filter((p) => p.sync?.active);
  const [justFinished, setJustFinished] = useState(false);
  const wasSyncing = useRef(false);

  useEffect(() => {
    if (syncing.length) { wasSyncing.current = true; return; }
    if (!wasSyncing.current) return;
    wasSyncing.current = false;
    setJustFinished(true);
    const t = setTimeout(() => setJustFinished(false), 5000);
    return () => clearTimeout(t);
  }, [syncing.length]);

  if (!syncing.length && !justFinished) return null;
  if (!syncing.length) {
    return <div className="syncbar done"><span className="sync-check">✓</span> All your chats are synced</div>;
  }

  return (
    <div className="syncbar">
      {syncing.map((p) => {
        const { text, frac } = describe(p);
        const net = networkInfo(p.net);
        const sameNet = profiles.filter((x) => x.net === p.net);
        const label = sameNet.length < 2 ? '' : sameNet.filter((x) => x.name === p.name).length > 1 ? ` · ${cleanName(p.detail || p.name)}` : ` · ${cleanName(p.name)}`;
        return (
          <div key={p.key} className="sync-item">
            <div className="sync-top">
              <span className="sync-title">Syncing {net.name}{label}</span>
              {frac != null && <span className="sync-pct">{Math.round(frac * 100)}%</span>}
            </div>
            <div className={`sync-track ${frac == null ? 'indeterminate' : ''}`}>
              <i style={frac != null ? { width: `${Math.max(3, frac * 100)}%` } : undefined} />
            </div>
            <div className="sync-text">{text}</div>
          </div>
        );
      })}
    </div>
  );
}

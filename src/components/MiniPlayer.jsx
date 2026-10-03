import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import VolumeSlider from './VolumeSlider.jsx';
import { player, usePlayer } from '../player.js';
import { bars, fmt } from './VoicePlayer.jsx';

const pad = (s) => fmt(s).padStart(5, '0');

/** Now-playing bar at the bottom of the chat list, like Beeper's. */
export default function MiniPlayer() {
  const p = usePlayer();
  const [vol, setVol] = useState(false);
  const volRef = useRef(null);
  useEffect(() => {
    if (!vol) return;
    const close = (e) => { if (!volRef.current?.contains(e.target)) setVol(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [vol]);
  if (!p.src) return null;
  const shape = bars(p.meta?.waveform, p.meta?.id, 34);
  const progress = p.duration ? p.time / p.duration : 0;
  return (
    <div className="mini-player">
      <Avatar src={p.meta?.avatar} name={p.meta?.title || 'Audio'} id={p.meta?.id} size={30} />
      <button className="mp-btn" title="Back 10 s" onClick={() => player.skip(-10)}>
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 6h2v12H6V6Zm3.5 6 8.5 6V6l-8.5 6Z" /></svg>
      </button>
      <button className="mp-btn play" title={p.playing ? 'Pause' : 'Play'} onClick={() => player.toggle(p.src, p.meta)}>
        {p.playing
          ? <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
          : <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>}
      </button>
      <button className="mp-btn" title="Forward 10 s" onClick={() => player.skip(10)}>
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="m6 18 8.5-6L6 6v12Zm10-12v12h2V6h-2Z" /></svg>
      </button>
      <div className="mp-wave" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); player.seek((e.clientX - r.left) / r.width); }}>
        {shape.map((v, i) => <i key={i} className={i / shape.length < progress ? 'on' : ''} style={{ height: `${Math.round(v * 100)}%` }} />)}
      </div>
      <span className="mp-time">{pad(p.time)} / {pad(p.duration)}</span>
      <div className="mp-vol" ref={volRef}>
        <button className={`mp-btn ${vol ? 'on' : ''}`} title="Volume" onClick={() => setVol((v) => !v)}
          onWheel={(e) => player.setVolume(p.volume - Math.sign(e.deltaY) * 0.05)}>
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d={p.volume === 0
            ? 'M3 9v6h4l5 5V4L7 9H3Zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4-2.7-2.7Z'
            : 'M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4ZM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6Z'} /></svg>
        </button>
        {vol && <div className="mp-vol-pop"><VolumeSlider value={p.volume} onChange={(v) => player.setVolume(v)} /></div>}
      </div>
      <button className="mp-btn close" title="Close" onClick={() => player.stop()}>✕</button>
    </div>
  );
}

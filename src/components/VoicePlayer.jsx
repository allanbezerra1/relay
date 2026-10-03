import { useMemo } from 'react';
import { useMedia } from '../media.js';
import { player, usePlayer } from '../player.js';

const BARS = 42;
const SPEEDS = [1, 1.5, 2];

export function fmt(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Resample a waveform (0–1024 values from MSC1767) to a fixed number of bars, 0–1. */
export function bars(waveform, seed, n = BARS) {
  if (Array.isArray(waveform) && waveform.length) {
    const max = Math.max(...waveform, 1);
    return Array.from({ length: n }, (_, i) => Math.max(0.12, (waveform[Math.floor((i / n) * waveform.length)] || 0) / max));
  }
  // No waveform (e.g. a music file): a stable pseudo-random shape so it still looks like audio.
  let x = 0;
  for (const c of seed || 'relay') x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, () => {
    x = (x * 1103515245 + 12345) >>> 0;
    return 0.2 + ((x >>> 16) % 1000) / 1250;
  });
}

const pad = (sec) => fmt(sec).padStart(5, '0');

export default function VoicePlayer({ client, content, id, mine, who, trailing }) {
  const { url, error } = useMedia(client, content);
  const p = usePlayer();
  const meta = content['org.matrix.msc1767.audio'] || {};
  const isVoice = !!(content['org.matrix.msc3245.voice'] || content['org.matrix.msc3245.voice.v2']);
  const knownDuration = (meta.duration || content.info?.duration || 0) / 1000;
  const shape = useMemo(() => bars(meta.waveform, id, 34), [meta.waveform, id]);

  const current = url && p.src === url;
  const playing = current && p.playing;
  const duration = (current && p.duration) || knownDuration;
  const progress = current && duration ? p.time / duration : 0;
  const started = current && (p.playing || p.time > 0);

  const toggle = () => url && player.toggle(url, { id, title: who?.name || 'Voice message', avatar: who?.avatar, duration: knownDuration, waveform: meta.waveform });

  const seek = (e) => {
    if (!url) return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    if (!current) toggle();
    setTimeout(() => player.seek(f), current ? 0 : 150);
  };

  if (error) return <div className="media-error">🎤 Couldn’t load audio</div>;

  return (
    <div className={`voice ${mine ? 'mine' : ''} ${isVoice ? '' : 'music'}`}>
      {!isVoice && content.body && <div className="voice-name">{content.body}</div>}
      <div className="voice-row">
        <button className="voice-play" onClick={toggle} disabled={!url} aria-label={playing ? 'Pause' : 'Play'}>
          {!url ? <span className="spinner small" /> : playing ? (
            <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M7 4.6v14.8a1 1 0 0 0 1.52.85l12-7.4a1 1 0 0 0 0-1.7l-12-7.4A1 1 0 0 0 7 4.6Z" /></svg>
          )}
        </button>
        <div className="voice-wave" onClick={seek}>
          {shape.map((v, i) => (
            <i key={i} className={i / shape.length < progress ? 'on' : ''} style={{ height: `${Math.round(v * 100)}%` }} />
          ))}
        </div>
        <span className="voice-time">{started ? `${pad(p.time)}/${pad(duration)}` : pad(duration)}</span>
        <button className="voice-speed" onClick={() => player.setRate(SPEEDS[(SPEEDS.indexOf(p.rate) + 1) % SPEEDS.length])} title="Playback speed">
          {String(p.rate).replace('.', ',')}x
        </button>
        {trailing}
      </div>
    </div>
  );
}

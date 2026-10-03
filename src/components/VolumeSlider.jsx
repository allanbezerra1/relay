import { useRef } from 'react';

/** Speaker icon (click to mute/unmute) + slider + percentage. value is 0–1. */
export default function VolumeSlider({ value, onChange, onCommit, disabled }) {
  const pct = Math.round(value * 100);
  const last = useRef(value || 1); // what unmuting goes back to
  if (value > 0) last.current = value;
  return (
    <span className="volume">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="volume-icon" onClick={(e) => { e.preventDefault(); if (!disabled) { onChange(value ? 0 : last.current); onCommit?.(); } }}>
        <path fill="currentColor" d={value === 0 ? 'M3 9v6h4l5 5V4L7 9H3Zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4-2.7-2.7Z'
          : value < 0.5 ? 'M5 9v6h4l5 5V4L9 9H5Zm11.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4Z'
          : 'M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4ZM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6Z'} />
      </svg>
      <input type="range" min="0" max="100" step="1" value={pct} disabled={disabled} style={{ '--pct': `${pct}%` }}
        onChange={(e) => onChange(e.target.value / 100)}
        onPointerUp={() => onCommit?.()} onKeyUp={() => onCommit?.()} />
      <span className="volume-pct">{pct}%</span>
    </span>
  );
}

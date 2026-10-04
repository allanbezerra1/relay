import { useEffect, useState } from 'react';
import { usePrefs } from '../prefs.js';
import { PRESETS, previewStyle, setPrefAnimated } from '../presets.js';

function useSystemDark() {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  const [dark, setDark] = useState(!!mq?.matches);
  useEffect(() => {
    if (!mq) return;
    const on = (e) => setDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return dark;
}

/** Settings → Appearance → Style: big live previews, switching with a circular reveal. */
export default function PresetPicker() {
  const p = usePrefs();
  const systemDark = useSystemDark();
  const dark = p.theme === 'system' ? systemDark : p.theme === 'dark';
  const current = PRESETS.some((x) => x.id === p.preset) ? p.preset : 'classic';
  return (
    <div className="presets">
      {PRESETS.map((preset) => {
        const d = preset.mode ? preset.mode === 'dark' : dark;
        return (
          <button key={preset.id} type="button" className={`preset-card ${current === preset.id ? 'on' : ''}`}
            onClick={(e) => setPrefAnimated('preset', preset.id, e)} aria-pressed={current === preset.id}>
            <span className="preset-prev" style={previewStyle(preset, d)}>
              <span className="pp-glow" />
              <span className="pp-side"><i /><i className="on" /><i /><i /></span>
              <span className="pp-chat"><b /><b className="me" /><b className="short" /></span>
            </span>
            <span className="preset-name">
              {preset.name}
              {preset.mode && <small>{preset.mode === 'dark' ? 'Dark' : 'Light'}</small>}
            </span>
            <span className="preset-hint">{preset.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

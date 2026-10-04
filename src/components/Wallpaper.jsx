import { useState } from 'react';
import {
  WALLPAPERS, useChatWallpaper, useCustomWallpapers, useRoomWallpaperSetting, setRoomWallpaper,
  pickCustomWallpaper, removeCustomWallpaper, resolveWallpaper, isCustomWallpaper,
} from '../wallpapers.js';
import { usePrefs, setPref } from '../prefs.js';

/** The painted layers of a wallpaper (also used, scaled down, for the picker tiles). */
function Layers({ wp }) {
  return (
    <>
      <span className="wp-fill" style={wp.url ? { backgroundImage: `url("${wp.url}")` } : undefined} />
      <span className="wp-pattern" />
      <span className="wp-shade" />
    </>
  );
}

const vars = (wp) => ({ '--wp-dim': wp.dim, '--wp-blur': `${wp.blur}px` });

/** Behind the conversation, inside the chat card. Renders nothing for "None". */
export function ChatWallpaper({ client, room }) {
  const wp = useChatWallpaper(client, room);
  if (wp.id === 'none') return null;
  return (
    <div className={`wallpaper wp-${isCustomWallpaper(wp.id) ? 'image' : wp.id}`} style={vars(wp)} aria-hidden="true">
      <Layers wp={wp} />
    </div>
  );
}

function Tile({ wp, label, on, onClick, onRemove, extra }) {
  return (
    <button type="button" className={`wp-tile ${on ? 'on' : ''}`} onClick={onClick} title={label}>
      <span className={`wp-mini wallpaper wp-${isCustomWallpaper(wp.id) ? 'image' : wp.id}`} style={vars({ ...wp, blur: wp.blur / 4 })}>
        <Layers wp={wp} />
        {extra}
        {wp.id !== 'default' && <span className="wp-bubbles"><b /><b className="me" /></span>}
      </span>
      <span className="wp-label">{label}</span>
      {onRemove && (
        <span className="wp-remove" role="button" title="Remove this picture" onClick={(e) => { e.stopPropagation(); onRemove(); }}>✕</span>
      )}
    </button>
  );
}

function Slider({ label, value, min, max, step, format, onChange }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="wp-slider">
      <span className="wp-slider-head"><span>{label}</span><b>{format(value)}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} style={{ '--pct': `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/**
 * Grid of wallpapers + "Choose picture…" + Dim / Blur sliders.
 * `value` is a setting ({ id, dim, blur }); with `fallback`, a "Default" tile follows it.
 */
export function WallpaperPicker({ value, onChange, fallback, compact }) {
  const customs = useCustomWallpapers();
  const [error, setError] = useState(null);
  const current = value?.id || (fallback ? 'default' : 'none');
  const dim = value?.dim ?? 0;
  const blur = value?.blur ?? 0;
  const set = (patch) => onChange({ id: current, dim, blur, ...patch });
  const fallbackWp = resolveWallpaper(null, fallback); // what "Default" looks like
  const preview = (id) => ({ id, dim: current === id ? dim : 0, blur: current === id ? blur : 0, url: customs.find((c) => c.id === id)?.url });

  const pick = async () => {
    setError(null);
    try {
      const id = await pickCustomWallpaper();
      if (id) set({ id });
    } catch (err) {
      setError(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  return (
    <div className={`wp-picker ${compact ? 'compact' : ''}`}>
      <div className="wp-tiles">
        {fallback && (
          <Tile wp={fallbackWp} label="Default" on={current === 'default'}
            onClick={() => onChange({ id: 'default' })}
            extra={<span className="wp-badge">Default</span>} />
        )}
        {WALLPAPERS.map((w) => (
          <Tile key={w.id} wp={preview(w.id)} label={w.name} on={current === w.id} onClick={() => set({ id: w.id })} />
        ))}
        {customs.map((c, i) => (
          <Tile key={c.id} wp={preview(c.id)} label={`Imagem ${i + 1}`} on={current === c.id} onClick={() => set({ id: c.id })}
            onRemove={() => { if (current === c.id) set({ id: fallback ? 'default' : 'none' }); removeCustomWallpaper(c.id); }} />
        ))}
        {window.relay?.wallpaper && (
          <button type="button" className="wp-tile wp-add" onClick={pick} title="Choose a picture from your computer">
            <span className="wp-mini">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M19 5v14H5V5h14m0-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-4.86 8.86-3 3.87L9 13.14 6 17h12l-3.86-5.14Z" /></svg>
            </span>
            <span className="wp-label">{compact ? 'Picture…' : 'Choose picture…'}</span>
          </button>
        )}
      </div>
      {error && <p className="wp-error">{error}</p>}
      {current !== 'default' && current !== 'none' && (
        <div className="wp-sliders">
          <Slider label="Dim" value={dim} min={0} max={0.8} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ dim: v })} />
          <Slider label="Blur" value={blur} min={0} max={20} step={1} format={(v) => (v ? `${v} px` : 'None')} onChange={(v) => set({ blur: v })} />
        </div>
      )}
    </div>
  );
}

/** Settings → Appearance: the default for every chat. */
export function DefaultWallpaperPicker() {
  const p = usePrefs();
  return <WallpaperPicker value={p.wallpaper} onChange={(v) => setPref('wallpaper', v)} />;
}

/** Details panel: this chat's wallpaper (collapsed to one row until you want to change it). */
export function ChatWallpaperSection({ client, room }) {
  const p = usePrefs();
  const setting = useRoomWallpaperSetting(client, room);
  const wp = useChatWallpaper(client, room);
  const [open, setOpen] = useState(false);
  const name = setting.id === 'default' || !setting.id
    ? 'Relay default'
    : WALLPAPERS.find((w) => w.id === setting.id)?.name || (isCustomWallpaper(setting.id) ? 'Your picture' : 'Relay default');
  return (
    <section className="ip-section">
      <div className="ip-head">
        <span>Wallpaper</span>
        <button className="ip-link" onClick={() => setOpen(!open)}>{open ? 'Done' : 'Change'}</button>
      </div>
      <div className="ip-card wp-card">
        {!open ? (
          <button className="wp-current" onClick={() => setOpen(true)}>
            <span className={`wp-mini wallpaper wp-${isCustomWallpaper(wp.id) ? 'image' : wp.id}`} style={vars({ ...wp, blur: wp.blur / 4 })}>
              <Layers wp={wp} />
            </span>
            <span className="wp-current-text">
              <b>{name}</b>
              <small>{setting.id === 'default' || !setting.id ? 'Same as other chats' : 'Only in this chat'}</small>
            </span>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8.6 16.6 13.2 12 8.6 7.4 10 6l6 6-6 6-1.4-1.4Z" /></svg>
          </button>
        ) : (
          <WallpaperPicker compact value={setting.id === 'default' ? null : setting} fallback={p.wallpaper}
            onChange={(v) => setRoomWallpaper(client, room, v)} />
        )}
      </div>
    </section>
  );
}

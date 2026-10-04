import { useEffect, useRef, useState } from 'react';
import { mediaUrl } from '../matrix.js';
import { useStickers, importStickers, removeSticker, recentStickers } from '../stickers.js';

export const CATEGORIES = [
  ['Recent', '🕘', null],
  ['Smileys', '😀', '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖'],
  ['Gestures', '👍', '👍 👎 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🫡 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💪 🦾 🫵 👀 👁️ 🧠 🫀 👄 💋 🙋 🙆 🙅 🤷 🤦 🙇 💁 🧑‍💻 🏃 💃 🕺'],
  ['Hearts', '❤️', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 🩷 🩵 🩶 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 💯 💢 💥 💫 💦 💨 🔥 ✨ 🌟 ⭐ ⚡ 🎉 🎊 🎈 🎁 🏆 🥇'],
  ['Nature', '🐶', '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦅 🦉 🐺 🐴 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🐙 🐠 🐬 🐳 🦈 🌵 🌲 🌴 🌱 🍀 🍁 🌸 🌹 🌻 🌞 🌙 🌈 ☀️ 🌧️ ❄️ 🌊'],
  ['Food', '🍕', '🍏 🍎 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🌽 🌶️ 🥕 🥔 🍞 🧀 🥚 🍳 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🍝 🍜 🍣 🍱 🍤 🍙 🍦 🍩 🍪 🎂 🍰 🍫 🍿 ☕ 🍵 🧃 🥤 🍺 🍻 🥂 🍷 🍸 🍹'],
  ['Activity', '⚽', '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥊 🥋 ⛳ 🏹 🎣 🛹 🏂 🏋️ 🚴 🏊 🧘 🎮 🕹️ 🎲 🧩 🎯 🎳 🎸 🎹 🥁 🎤 🎧 🎬 🎨 📸 🎟️'],
  ['Travel', '🚗', '🚗 🚕 🚙 🚌 🏎️ 🚓 🚑 🚒 🛻 🚚 🏍️ 🛵 🚲 ✈️ 🚀 🛸 🚁 ⛵ 🚢 🚆 🚇 🗺️ 🏖️ 🏝️ ⛰️ 🏔️ 🏕️ 🏠 🏢 🏛️ 🗽 🗼 🎡 🎢 🌃 🌆'],
  ['Objects', '💡', '⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💾 📷 🎥 📺 📻 🔋 🔌 💡 🔦 🕯️ 💸 💵 💰 💳 💎 🔧 🔨 🛠️ ⚙️ 🔑 🔒 🔓 🧲 💊 🩺 🧸 🎀 📦 📫 ✉️ 📝 📌 📎 ✂️ 📚 📖 🗓️ 📈 📉 ⏰ ⌛'],
  ['Symbols', '✅', '✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ➗ ✖️ ♾️ ‼️ ⁉️ ❓ ❗ 〰️ 💲 ♻️ ⚠️ 🚫 ⛔ 🔞 📵 🆗 🆒 🆕 🆓 🆘 🔝 🔜 ▶️ ⏸️ ⏹️ ⏺️ 🔁 🔀 🔔 🔕 🎵 🎶 💬 💭 🗯️ ♥️ ♠️ ♣️ ♦️ 🏁 🚩 🏳️‍🌈 🇧🇷'],
];

const RECENT_KEY = 'relay.recentEmoji';

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}

export function rememberEmoji(e) {
  const list = [e, ...getRecent().filter((x) => x !== e)].slice(0, 32);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch {}
}

const MODE_KEY = 'relay.pickerMode';

/** Emoji grid; with `stickers` ({ client, onSend }) it also gets a Stickers tab. */
export default function EmojiPicker({ onPick, onClose, className = '', stickers = null }) {
  const ref = useRef(null);
  const recent = getRecent();
  const [cat, setCat] = useState(recent.length ? 0 : 1);
  const [mode, setModeState] = useState(() => { try { return stickers && localStorage.getItem(MODE_KEY) === 'stickers' ? 'stickers' : 'emoji'; } catch { return 'emoji'; } });
  const setMode = (m) => { setModeState(m); try { localStorage.setItem(MODE_KEY, m); } catch {} };

  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    setTimeout(() => window.addEventListener('mousedown', close), 0);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc, true); };
  }, [onClose]);

  const list = cat === 0 ? recent : CATEGORIES[cat][2].split(' ');
  const modeTabs = stickers && (
    <div className="picker-modes">
      <button className={mode === 'emoji' ? 'on' : ''} onClick={() => setMode('emoji')}>Emoji</button>
      <button className={mode === 'stickers' ? 'on' : ''} onClick={() => setMode('stickers')}>Stickers</button>
    </div>
  );

  if (mode === 'stickers') {
    return (
      <div className={`emoji-picker ${className}`} ref={ref}>
        {modeTabs}
        <StickerGrid client={stickers.client} onSend={(s) => { stickers.onSend(s); onClose(); }} />
      </div>
    );
  }

  return (
    <div className={`emoji-picker ${className}`} ref={ref}>
      {modeTabs}
      <div className="emoji-tabs">
        {CATEGORIES.map(([name, icon], i) => (
          (i > 0 || recent.length > 0) && (
            <button key={name} className={cat === i ? 'on' : ''} onClick={() => setCat(i)} title={name}>{icon}</button>
          )
        ))}
      </div>
      <div className="emoji-title">{CATEGORIES[cat][0]}</div>
      <div className="emoji-grid">
        {list.map((e) => (
          <button key={e} onClick={() => { rememberEmoji(e); onPick(e); }}>{e}</button>
        ))}
      </div>
    </div>
  );
}

const STICKER_TABS = [
  ['recent', 'Recent', 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7Z'],
  ['favorites', 'Favorites', 'm12 17.3 6.2 3.7-1.6-7 5.4-4.7-7.1-.6L12 2 9.1 8.7 2 9.3l5.4 4.7-1.6 7z'],
  ['saved', 'Saved', 'M5 3h10l6 6v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm9 1.6V8a2 2 0 0 0 2 2h3.4L14 4.6Z'],
];
const STICKER_TAB_KEY = 'relay.stickerTab';

function StickerGrid({ client, onSend }) {
  const all = useStickers(client);
  const [recent] = useState(() => recentStickers(client));
  const favorites = all.filter((s) => s.wa);
  const saved = all.filter((s) => !s.wa);
  const [tab, setTabState] = useState(() => {
    let t = null;
    try { t = localStorage.getItem(STICKER_TAB_KEY); } catch {}
    return t || (recent.length ? 'recent' : favorites.length ? 'favorites' : 'saved');
  });
  const setTab = (t) => { setTabState(t); try { localStorage.setItem(STICKER_TAB_KEY, t); } catch {} };
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [over, setOver] = useState(false);

  const addFiles = async (files) => {
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    setTab('saved');
    setBusy(true);
    setError(null);
    try { await importStickers(client, images); } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const list = tab === 'recent' ? recent : tab === 'favorites' ? favorites : saved;
  const empty = {
    recent: 'Stickers you send show up here.',
    favorites: 'Your WhatsApp favorite stickers show up here. Favorite one on the phone and it appears in a moment.',
    saved: 'Right-click a sticker in a chat → Save sticker, or add images with +.',
  }[tab];

  return (
    <div
      className={`sticker-panel ${over ? 'over' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); addFiles(e.dataTransfer.files); }}
    >
      <div className="sticker-tabs">
        {STICKER_TABS.map(([id, label, d]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} title={label}>
            <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d={d} /></svg>
            <span>{label}</span>
            {id === 'favorites' && favorites.length > 0 && <span className="sticker-count">{favorites.length}</span>}
          </button>
        ))}
      </div>
      <div className="sticker-grid">
        {tab === 'saved' && (
          <button className="sticker-add" title="Add stickers from images" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <span className="spinner small" /> : <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" /></svg>}
          </button>
        )}
        {list.map((s) => (
          <div key={s.id} className="sticker-cell">
            <button className="sticker" title={s.body} onClick={() => onSend(s)}>
              <img src={mediaUrl(client, s.url)} alt={s.body} loading="lazy" draggable={false} />
            </button>
            {tab !== 'recent' && (
              <button className="sticker-remove" title={s.wa ? 'Hide from Relay (unfavorite on the phone to remove it there)' : 'Remove from my stickers'} onClick={() => removeSticker(client, s.id)}>✕</button>
            )}
          </div>
        ))}
      </div>
      {!list.length && !busy && <p className="sticker-empty">{empty}</p>}
      {error && <p className="sticker-empty error-text">{error}</p>}
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

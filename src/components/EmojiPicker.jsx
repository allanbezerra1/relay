import { useEffect, useRef, useState } from 'react';
import { mediaUrl } from '../matrix.js';
import { useStickers, importStickers, removeSticker } from '../stickers.js';

const CATEGORIES = [
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

function StickerGrid({ client, onSend }) {
  const list = useStickers(client);
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [over, setOver] = useState(false);

  const addFiles = async (files) => {
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    setBusy(true);
    setError(null);
    try { await importStickers(client, images); } catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <div
      className={`sticker-panel ${over ? 'over' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); addFiles(e.dataTransfer.files); }}
    >
      <div className="sticker-grid">
        <button className="sticker-add" title="Add stickers from images" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? <span className="spinner small" /> : <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" /></svg>}
        </button>
        {list.map((s) => (
          <div key={s.id} className="sticker-cell">
            <button className="sticker" title={s.body} onClick={() => onSend(s)}>
              <img src={mediaUrl(client, s.url)} alt={s.body} loading="lazy" draggable={false} />
            </button>
            <button className="sticker-remove" title="Remove from my stickers" onClick={() => removeSticker(client, s.id)}>✕</button>
          </div>
        ))}
      </div>
      {!list.length && !busy && (
        <p className="sticker-empty">Right-click a sticker in a chat → <b>Save sticker</b>, or add images with +.</p>
      )}
      {error && <p className="sticker-empty error-text">{error}</p>}
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

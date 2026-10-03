import { useEffect, useRef, useState } from 'react';

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

export default function EmojiPicker({ onPick, onClose, className = '' }) {
  const ref = useRef(null);
  const recent = getRecent();
  const [cat, setCat] = useState(recent.length ? 0 : 1);

  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    setTimeout(() => window.addEventListener('mousedown', close), 0);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc, true); };
  }, [onClose]);

  const list = cat === 0 ? recent : CATEGORIES[cat][2].split(' ');

  return (
    <div className={`emoji-picker ${className}`} ref={ref}>
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

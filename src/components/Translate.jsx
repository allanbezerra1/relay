// Message translation UI: the "Translate" chip and the translation under a message, and the
// "Translate" / "Auto" buttons in the chat header. Logic and prompts: src/translate.js.
// Styles: src/styles/translate.css.
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePrefs } from '../prefs.js';
import { aiPrefs, useAiReadyQuiet } from '../ai.js';
import {
  useTranslation, translateEvent, hideTranslation, showTranslation, foreignLang, langName, targetTag,
  translateMany, foreignMessages, useTranslationsVersion, translationOf,
  autoTranslateLang, setAutoTranslate, roomLanguage,
} from '../translate.js';

export const TRANSLATE_PATH = 'm12.87 15.07-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04ZM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12Zm-2.62 7 1.62-4.33L19.12 17h-3.24Z';

export const TranslateIcon = ({ size = 14 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={TRANSLATE_PATH} /></svg>
);

// ---------- Under a message ----------

/** "Translate" chip under messages in another language, and the translation once asked for. */
export function MessageTranslation({ ev, body, mine }) {
  const prefs = usePrefs();
  const p = aiPrefs(prefs);
  const ready = useAiReadyQuiet();
  const id = ev.getId();
  const tr = useTranslation(id);
  const target = targetTag(prefs);
  const detected = useMemo(() => (body ? foreignLang(body, prefs) : null), [body, target]); // eslint-disable-line react-hooks/exhaustive-deps
  const lang = tr?.lang || detected;
  const usable = ready && !!body && !ev.status && !ev.isRedacted();
  // Chats with automatic translation: translate as soon as the message shows up.
  const auto = !!autoTranslateLang(ev.getRoomId(), prefs);
  useEffect(() => {
    if (usable && auto && !mine && !tr && detected) translateEvent(id, body);
  }, [usable, auto, mine, tr, detected, id, body]);

  const original = mine && ev.getContent()['dev.relay.original'];
  if (original && !ev.isRedacted()) return <SentTranslation ev={ev} original={original} />;
  if (!usable) return null;
  const name = lang ? langName(lang) : '';
  if (!tr) {
    if (mine || !p.aiTranslate || !detected) return null;
    return (
      <button className={`tr-chip ${mine ? 'mine' : ''}`} onClick={() => translateEvent(id, body)}
        title={`Translate into ${langName(target)} with your local AI`}>
        <TranslateIcon size={13} /> Translate{name ? <small>{name}</small> : null}
      </button>
    );
  }
  if (!tr.shown) {
    return <button className={`tr-chip ${mine ? 'mine' : ''}`} onClick={() => showTranslation(id)}><TranslateIcon size={13} /> Show translation</button>;
  }
  return (
    <div className={`tr-card ${mine ? 'mine' : ''} is-${tr.state}`}>
      <div className="tr-head">
        <TranslateIcon size={12} />
        <span>{tr.state === 'error' ? 'Couldn’t translate' : tr.state === 'loading' && !tr.text ? 'Translating…' : `Translated${name ? ` from ${name}` : ''}`}</span>
        <button onClick={() => hideTranslation(id)} title="Hide the translation">Hide</button>
      </div>
      {tr.state === 'error' ? (
        <div className="tr-err">{tr.error} <button onClick={() => translateEvent(id, body)}>Try again</button></div>
      ) : tr.text ? (
        <p>{tr.text}{tr.state === 'loading' && <span className="ai-caret" />}</p>
      ) : (
        <div className="tr-skel"><i /><i /></div>
      )}
    </div>
  );
}

/** Under my own message that went out translated: what I actually wrote. */
function SentTranslation({ ev, original }) {
  const [open, setOpen] = useState(false);
  const to = ev.getContent()['dev.relay.translated_to'];
  const name = to ? langName(to) : 'another language';
  return open ? (
    <div className="tr-card mine is-done">
      <div className="tr-head">
        <TranslateIcon size={12} /><span>You wrote</span>
        <button onClick={() => setOpen(false)}>Hide</button>
      </div>
      <p>{original}</p>
    </div>
  ) : (
    <button className="tr-chip mine" onClick={() => setOpen(true)} title="See what you wrote before it was translated">
      <TranslateIcon size={13} /> Sent in {name}<small>Show original</small>
    </button>
  );
}

// ---------- Chat header ----------

/** "Translate" (every message in another language at once) and "Auto" (per-chat automatic translation). */
export function TranslateChatButtons({ client, room, onToast }) {
  const rawPrefs = usePrefs();
  const p = aiPrefs(rawPrefs);
  const ready = useAiReadyQuiet();
  const [progress, setProgress] = useState(null); // null | { done, total }
  const me = client.getUserId();
  const enabled = ready && p.aiTranslate;
  useTranslationsVersion();
  const items = enabled ? foreignMessages(room, me) : [];
  const allShown = items.length > 0 && items.every((x) => { const t = translationOf(x.id); return t?.shown && t.state === 'done'; });
  const autoLang = autoTranslateLang(room.roomId, rawPrefs);

  // A translation running when the chat changes keeps going; only its progress pill is dropped.
  const roomRef = useRef(room.roomId);
  roomRef.current = room.roomId;
  useEffect(() => setProgress(null), [room.roomId]);

  const go = async () => {
    const list = foreignMessages(room, me);
    if (!list.length) return;
    const forRoom = room.roomId;
    const step = (done, total) => { if (roomRef.current === forRoom) setProgress(done < total ? { done, total } : null); };
    step(0, list.length);
    const res = await translateMany(list, step);
    if (roomRef.current === forRoom) setProgress(null);
    if (!res.ok) onToast?.(res.error);
  };

  if (!ready || (!enabled && !autoLang)) return null;

  const toggleAuto = () => {
    if (autoLang) { setAutoTranslate(room.roomId, null); onToast?.('Automatic translation off'); return; }
    const lang = roomLanguage(room, me) || 'en';
    setAutoTranslate(room.roomId, lang);
    onToast?.(`Automatic translation on · ${langName(lang)} ⇄ ${langName(targetTag(rawPrefs))}`);
    if (items.length) go();
  };
  const autoBtn = (autoLang || items.length > 0) && (
    <button className={`ai-sum-btn tr-auto-btn ${autoLang ? 'on' : ''}`} onClick={toggleAuto}
      title={autoLang
        ? `Automatic translation is on: messages are translated as they arrive, and what you write is sent in ${langName(autoLang)}. Click to turn it off.`
        : 'Automatic translation: translate what arrives, and send what you write in the chat’s language'}>
      <TranslateIcon size={15} /><span>{autoLang ? `Auto · ${langName(autoLang)}` : 'Auto'}</span>
    </button>
  );

  let main = null;
  if (progress) {
    main = (
      <button className="ai-sum-btn tr-btn on" disabled>
        <span className="tr-spin" /><span>Translating {progress.done}/{progress.total}</span>
      </button>
    );
  } else if (allShown && !autoLang) {
    main = (
      <button className="ai-sum-btn tr-btn" onClick={() => items.forEach((x) => hideTranslation(x.id))} title="Hide the translations">
        <TranslateIcon size={16} /><span>Show originals</span>
      </button>
    );
  } else if (items.length && !autoLang) {
    main = (
      <button className="ai-sum-btn tr-btn" onClick={go}
        title={`Translate the ${items.length === 1 ? 'message' : `${items.length} messages`} in another language into ${langName(targetTag(rawPrefs))}`}>
        <TranslateIcon size={16} /><span>Translate</span>
      </button>
    );
  }
  if (!main && !autoBtn) return null;
  return <>{main}{autoBtn}</>;
}

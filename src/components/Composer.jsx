import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { MsgType } from 'matrix-js-sdk';
import { effectiveContent, senderName, previewText, stripReplyFallback } from '../matrix.js';
import { usePrefs } from '../prefs.js';
import EmojiPicker from './EmojiPicker.jsx';
import { sendSticker } from '../stickers.js';
import NetIcon from './NetIcon.jsx';
import { uiSound } from '../sounds.js';
import MediaTray from './MediaTray.jsx';

const drafts = new Map(); // roomId -> text, kept while the app is open

const ICON = {
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  photo: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2ZM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5Z',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm2 16H8v-2h8v2Zm0-4H8v-2h8v2Zm-3-5V3.5L18.5 9H13Z',
  camera: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM9 2 7.17 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3.17L15 2H9Z',
  smile: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm-3.5-9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM12 17.5c2.3 0 4.3-1.4 5.1-3.5H6.9c.8 2.1 2.8 3.5 5.1 3.5Z',
  mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z',
  send: 'M12 4 5 11l1.41 1.41L11 7.83V20h2V7.83l4.59 4.58L19 11l-7-7Z',
  wave: 'M7 18h2V6H7v12Zm4 4h2V2h-2v20Zm-8-8h2v-4H3v4Zm12 4h2V6h-2v12Zm4-8v4h2v-4h-2Z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z',
};

function Icon({ d, size = 20 }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
}

const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- Voice recording ----------

function useVoiceRecorder() {
  const [rec, setRec] = useState(null); // { start, levels }
  const [elapsed, setElapsed] = useState(0);
  const parts = useRef(null);

  const start = async () => {
    if (!(await window.relay.askMic?.() ?? true)) {
      throw new Error('Relay needs microphone access. Allow it in System Settings → Privacy & Security → Microphone.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const ogg = await window.relay.canMakeOgg?.();
    const mimeType = ogg ? 'audio/webm;codecs=opus' : 'audio/mp4';
    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48000 });
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    // Sample loudness ~10×/s for the waveform and the live meter.
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const levels = [];
    const startedAt = Date.now();
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      levels.push(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      setElapsed(Date.now() - startedAt);
    }, 100);

    recorder.start(250);
    parts.current = { stream, recorder, chunks, ctx, timer, levels, startedAt, ogg };
    setElapsed(0);
    setRec({ levels });
  };

  const finish = () => new Promise((resolve) => {
    const p = parts.current;
    parts.current = null;
    setRec(null);
    if (!p) return resolve(null);
    clearInterval(p.timer);
    p.recorder.onstop = () => {
      p.stream.getTracks().forEach((t) => t.stop());
      p.ctx.close();
      resolve(p);
    };
    p.recorder.stop();
  });

  const cancel = () => finish();

  /** Stop and turn the recording into a File plus voice-message metadata. */
  const stop = async () => {
    const p = await finish();
    if (!p) return null;
    const duration = Date.now() - p.startedAt;
    if (duration < 700) return null; // a click, not a message
    const blob = new Blob(p.chunks, { type: p.recorder.mimeType });
    let file;
    if (p.ogg) {
      const ogg = await window.relay.toOgg(new Uint8Array(await blob.arrayBuffer()));
      if (!ogg) throw new Error('Couldn’t convert the recording.');
      file = new File([ogg], 'Voice message.ogg', { type: 'audio/ogg' });
    } else {
      file = new File([blob], 'Voice message.m4a', { type: 'audio/mp4' });
    }
    // 64-point waveform scaled to 0–1024, as MSC1767 expects.
    const n = 64;
    const waveform = Array.from({ length: n }, (_, i) => {
      const slice = p.levels.slice(Math.floor((i / n) * p.levels.length), Math.floor(((i + 1) / n) * p.levels.length) || undefined);
      const v = slice.length ? Math.max(...slice) : 0;
      return Math.round(v * 1024);
    });
    return { file, duration, waveform };
  };

  useEffect(() => () => { if (parts.current) finish(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { recording: !!rec, levels: rec?.levels || [], elapsed, start, stop, cancel };
}

// ---------- Composer ----------

const Composer = forwardRef(function Composer(
  { client, room, network, networkId, roomName, replyTo, editing, onCancel, onSent, onEditLast, onFiles, onVoice,
    staged = [], onUnstage, onClearStaged, onSendStaged, onStagedChange },
  ref,
) {
  const [text, setText] = useState(() => drafts.get(room.roomId) || '');
  const { enterToSend } = usePrefs();
  const [menu, setMenu] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [voiceError, setVoiceError] = useState(null);
  const [sendingVoice, setSendingVoice] = useState(false);
  const input = useRef(null);
  const photoInput = useRef(null);
  const fileInput = useRef(null);
  const menuRef = useRef(null);
  const typingSent = useRef(0);
  const voice = useVoiceRecorder();

  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }));

  useEffect(() => { input.current?.focus(); }, [room.roomId]);

  // Prefill when editing.
  useEffect(() => {
    if (editing) {
      setText(stripReplyFallback(effectiveContent(editing).body || ''));
      requestAnimationFrame(() => {
        const el = input.current;
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      });
    }
  }, [editing]);

  // Grow with content.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [text]);

  useEffect(() => () => { client.sendTyping(room.roomId, false, 0).catch(() => {}); }, [client, room.roomId]);

  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setMenu(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const update = (value) => {
    setText(value);
    if (!editing) drafts.set(room.roomId, value);
    const now = Date.now();
    if (value && now - typingSent.current > 4000) {
      typingSent.current = now;
      client.sendTyping(room.roomId, true, 6000).catch(() => {});
    } else if (!value && typingSent.current) {
      typingSent.current = 0;
      client.sendTyping(room.roomId, false, 0).catch(() => {});
    }
  };

  const insert = (str) => {
    const el = input.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + str + text.slice(end);
    update(next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + str.length, start + str.length); });
  };

  const [asDocument, setAsDocument] = useState(false);
  // View once (WhatsApp): photos/videos in the tray, or the voice message being recorded.
  const [viewOnce, setViewOnce] = useState(false);
  const canViewOnce = /^whatsapp/.test(networkId || '');
  const stagedMediaOnly = staged.length > 0 && staged.every((s) => /^(image|video)\//.test(s.file.type));
  // Each staged item has its own caption; the text box edits the selected one's.
  const [selId, setSelId] = useState(null);
  const selItem = staged.find((s) => s.id === selId) || staged[0];
  const captionOf = useRef(null);
  useEffect(() => {
    const id = selItem?.id || null;
    if (captionOf.current === id) return;
    if (captionOf.current && id) setText(selItem.caption || ''); // the first item keeps what was already typed
    captionOf.current = id;
  }, [selItem?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectStaged = (id) => {
    if (selItem && id !== selItem.id) onStagedChange((list) => list.map((x) => (x.id === selItem.id ? { ...x, caption: text } : x)));
    setSelId(id);
    input.current?.focus();
  };
  const send = async () => {
    const body = text.trim();
    if (staged.length) {
      const items = staged.map((x) => ({ ...x, caption: (x.id === selItem.id ? body : x.caption || '').trim() }));
      setText('');
      drafts.delete(room.roomId);
      const reply = replyTo;
      onSent();
      uiSound('send');
      await onSendStaged(items, asDocument, reply, viewOnce && stagedMediaOnly && !asDocument);
      setAsDocument(false);
      setViewOnce(false);
      return;
    }
    if (!body) return;
    setText('');
    drafts.delete(room.roomId);
    typingSent.current = 0;
    client.sendTyping(room.roomId, false, 0).catch(() => {});

    let content;
    if (body.startsWith('/me ')) content = { msgtype: MsgType.Emote, body: body.slice(4) };
    else if (body.startsWith('/shrug')) content = { msgtype: MsgType.Text, body: `¯\\_(ツ)_/¯ ${body.slice(6).trim()}`.trim() };
    else content = { msgtype: MsgType.Text, body };

    if (editing) {
      content = {
        msgtype: content.msgtype,
        body: `* ${content.body}`,
        'm.new_content': content,
        'm.relates_to': { rel_type: 'm.replace', event_id: editing.getId() },
      };
    } else if (replyTo) {
      content['m.relates_to'] = { 'm.in_reply_to': { event_id: replyTo.getId() } };
    }

    onSent();
    uiSound('send');
    try {
      await client.sendMessage(room.roomId, content);
    } catch (err) {
      console.error('Send failed', err); // the failed local echo shows a retry button
    }
  };

  const sendStickerNow = async (sticker) => {
    uiSound('send');
    try { await sendSticker(client, room.roomId, sticker, replyTo); } catch (err) { console.error('Sticker failed', err); }
    onSent();
  };

  const startVoice = async () => {
    setVoiceError(null);
    try { await voice.start(); }
    catch (err) { setVoiceError(err.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in System Settings → Privacy & Security → Microphone.' : err.message); }
  };

  const sendVoice = async () => {
    setSendingVoice(true);
    try {
      const rec = await voice.stop();
      if (rec) { uiSound('send'); await onVoice({ ...rec, viewOnce: canViewOnce && viewOnce }, replyTo); }
      setViewOnce(false);
      onSent();
    } catch (err) {
      setVoiceError(err.message);
    } finally {
      setSendingVoice(false);
    }
  };

  const onKeyDown = (e) => {
    const sendCombo = enterToSend ? !e.shiftKey && !e.metaKey : e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && sendCombo && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape' && staged.length) {
      e.preventDefault();
      onClearStaged();
    } else if (e.key === 'Escape' && (replyTo || editing)) {
      e.preventDefault();
      if (editing) setText(drafts.get(room.roomId) || '');
      onCancel();
    } else if (e.key === 'ArrowUp' && !text) {
      e.preventDefault();
      onEditLast();
    }
  };

  const onPaste = (e) => {
    const files = [...e.clipboardData.files];
    if (files.length) { e.preventDefault(); onFiles(files); }
  };

  const pick = (inputRef) => { setMenu(false); inputRef.current?.click(); };
  const contextEv = editing || replyTo;
  const hasText = !!text.trim() || staged.length > 0;

  return (
    <div className="composer">
      {contextEv && (
        <div className="composer-context">
          <div>
            <span className="ctx-label">{editing ? 'Editing message' : `Replying to ${senderName(room, replyTo.getSender())}`}</span>
            <span className="ctx-text">{previewText(room, contextEv, '').replace(/^[^:]+: /, '')}</span>
          </div>
          <button onClick={() => { if (editing) setText(drafts.get(room.roomId) || ''); onCancel(); }} title="Cancel (Esc)">✕</button>
        </div>
      )}
      {staged.length > 0 && (
        <MediaTray staged={staged} onChange={onStagedChange} selectedId={selItem?.id} onSelect={selectStaged}
          asDocument={asDocument} onAsDocument={setAsDocument} onClear={onClearStaged} onRemove={onUnstage}
          onAddMore={() => photoInput.current?.click()}
          canViewOnce={canViewOnce && stagedMediaOnly && !asDocument} viewOnce={viewOnce} onViewOnce={setViewOnce} />
      )}
      {voiceError && <div className="composer-error">{voiceError} <button onClick={() => setVoiceError(null)}>✕</button></div>}

      <input ref={photoInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { onFiles([...e.target.files]); e.target.value = ''; }} />
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { onFiles([...e.target.files]); e.target.value = ''; }} />

      {voice.recording || sendingVoice ? (
        <div className="composer-row recording">
          <button className="round-btn danger-btn" onClick={voice.cancel} disabled={sendingVoice} title="Discard recording"><Icon d={ICON.trash} /></button>
          <span className="rec-dot" />
          <span className="rec-time">{fmt(voice.elapsed)}</span>
          <div className="rec-levels">
            {voice.levels.slice(-60).map((v, i) => <i key={i} style={{ height: `${Math.max(8, v * 100)}%` }} />)}
          </div>
          {canViewOnce && (
            <button className={`view-once-btn ${viewOnce ? 'on' : ''}`} onClick={() => setViewOnce(!viewOnce)}
              title={viewOnce ? 'View once: on (they can play it one time)' : 'Send as view once'}>1</button>
          )}
          <button className="round-btn send ready" onClick={sendVoice} disabled={sendingVoice} title="Send voice message">
            {sendingVoice ? <span className="spinner small light" /> : <Icon d={ICON.send} size={18} />}
          </button>
        </div>
      ) : (
        <div className="composer-row">
          <div className="plus-wrap" ref={menuRef}>
            <button className={`round-btn ${menu ? 'on' : ''}`} onClick={() => setMenu(!menu)} title="Attach">
              <Icon d={ICON.plus} size={22} />
            </button>
            {menu && (
              <div className="attach-menu">
                <button onClick={() => pick(photoInput)}><span className="am-icon" style={{ '--c': '#7c5cff' }}><Icon d={ICON.photo} size={18} /></span>Photos &amp; videos</button>
                <button onClick={() => pick(fileInput)}><span className="am-icon" style={{ '--c': '#2f80ed' }}><Icon d={ICON.doc} size={18} /></span>Document</button>
                <button onClick={() => { setMenu(false); startVoice(); }}><span className="am-icon" style={{ '--c': '#ef4444' }}><Icon d={ICON.mic} size={18} /></span>Voice message</button>
                <div className="am-hint">You can also paste or drag files here.</div>
              </div>
            )}
          </div>

          <div className="input-wrap">
            {networkId && networkId !== 'matrix' && <span className="input-net"><NetIcon id={networkId} variant="plain" size={16} /></span>}
            <textarea
              ref={input}
              rows={1}
              value={text}
              onChange={(e) => update(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder={staged.length ? 'Add a caption…' : network.name !== 'Matrix' ? `Message ${roomName || ''} on ${network.name}` : 'Message'}
            />
            <button className={`icon-in ${emoji ? 'on' : ''}`} onClick={() => setEmoji(!emoji)} title="Emoji"><Icon d={ICON.smile} /></button>
            {!hasText && !editing && <button className="icon-in" onClick={startVoice} title="Record a voice message"><Icon d={ICON.wave} /></button>}
            {emoji && <EmojiPicker className="for-composer" onPick={insert} onClose={() => setEmoji(false)} stickers={{ client, onSend: sendStickerNow }} />}
          </div>

          <button className={`round-btn send ${hasText || editing ? 'ready' : ''}`} onClick={send} disabled={!hasText && !editing} title={enterToSend ? 'Send (Enter)' : 'Send (⌘Enter)'}>
            <Icon d={ICON.send} size={20} />
          </button>
        </div>
      )}
    </div>
  );
});

export default Composer;

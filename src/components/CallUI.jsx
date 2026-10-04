import { useEffect, useState } from 'react';
import { useCalls, startCall, openCalls, answerCall, declineCall, hangupCall, callDuration } from '../calls.js';

export const PHONE_D = 'M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z';
export const VIDEO_D = 'M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4Z';
export const WAITING_FOR_QR = 'Scan the QR code in WhatsApp Web with your phone; the call starts as soon as it’s linked.';

const Svg = ({ d, size = 18 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>;

/** Voice / video buttons in a WhatsApp chat's header. */
export function CallButtons({ roomId, name, onError }) {
  const calls = useCalls();
  const [busy, setBusy] = useState(null);
  const go = async (video) => {
    setBusy(video ? 'video' : 'voice');
    try {
      const r = await startCall(roomId, video, name);
      if (r && !r.ok && r.error) onError?.(r.error);
      else if (r?.waiting) onError?.(WAITING_FOR_QR);
    } finally { setBusy(null); }
  };
  const disabled = calls.inCall || !!busy;
  return (
    <div className="call-btns">
      <button className={`call-btn ${busy === 'voice' ? 'busy' : ''}`} onClick={() => go(false)} disabled={disabled} title="Voice call (WhatsApp)">
        <Svg d={PHONE_D} />
      </button>
      <button className={`call-btn ${busy === 'video' ? 'busy' : ''}`} onClick={() => go(true)} disabled={disabled} title="Video call (WhatsApp)">
        <Svg d={VIDEO_D} size={19} />
      </button>
    </div>
  );
}

/** Floating pill while a call is ringing or in progress. */
export function CallPill() {
  const calls = useCalls();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!calls.inCall) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [calls.inCall]);

  if (calls.ringing) {
    return (
      <div className="call-pill ringing">
        <span className="cp-dot" />
        <span className="cp-text"><b>{calls.ringing.name}</b><small>{calls.ringing.video ? 'WhatsApp video call' : 'WhatsApp voice call'}</small></span>
        <button className="cp-btn cp-no" onClick={declineCall} title="Decline" aria-label="Decline"><Svg d={PHONE_D} size={16} /></button>
        <button className="cp-btn cp-ok" onClick={answerCall} title="Answer" aria-label="Answer"><Svg d={calls.ringing.video ? VIDEO_D : PHONE_D} size={16} /></button>
      </div>
    );
  }
  if (!calls.inCall) return null;
  const who = calls.call;
  return (
    <div className="call-pill live" onClick={openCalls} title="Back to the call" role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openCalls(); }}>
      <span className="cp-wave"><i /><i /><i /><i /></span>
      <span className="cp-text">
        <b>{who?.name || 'In a call'}</b>
        <small>
          {who && <><span className="cp-kind"><Svg d={who.video ? VIDEO_D : PHONE_D} size={12} />{who.video ? 'Video' : 'Voice'}</span>{' · '}</>}
          {calls.inCallSince ? callDuration(calls.inCallSince, now) : (who?.dir === 'out' ? 'calling…' : 'connecting…')}
        </small>
      </span>
      {!calls.windowVisible && <span className="cp-back">Show</span>}
      <button className="cp-btn cp-no cp-end" title="End call" aria-label="End call" onClick={(e) => { e.stopPropagation(); hangupCall(); }}>
        <Svg d={PHONE_D} size={16} />
      </button>
    </div>
  );
}

/** The bridge's "Incoming call" notice, drawn as a call card with "Call back". */
export function CallNotice({ video, mine, roomId, name, time, onError }) {
  const back = async () => {
    const r = await startCall(roomId, video, name);
    if (r && !r.ok && r.error) onError?.(r.error);
    else if (r?.waiting) onError?.(WAITING_FOR_QR);
  };
  return (
    <div className={`call-notice ${mine ? 'mine' : ''}`}>
      <span className={`cn-icon ${video ? 'video' : ''}`}><Svg d={video ? VIDEO_D : PHONE_D} size={18} /></span>
      <span className="cn-text">
        <b>{video ? 'Video call' : 'Voice call'}</b>
        <small>{mine ? 'Outgoing' : 'Incoming'}{time ? ` · ${time}` : ''}</small>
      </span>
      {roomId && (
        <button className="cn-back" onClick={back} title={video ? 'Video call back' : 'Call back'}>
          Call back
        </button>
      )}
    </div>
  );
}

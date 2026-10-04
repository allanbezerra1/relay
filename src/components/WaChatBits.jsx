// Small WhatsApp bits for the chat view: the disappearing-messages system line and header badge.
import { roomTimer, timerLabel, TIMERS } from '../whatsapp-power.js';

export function TimerIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d="M15 1H9v2h6V1Zm-4 13h2V8h-2v6Zm8.03-6.61 1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.96 8.96 0 0 0 12 4a9 9 0 1 0 9 9c0-2.12-.74-4.07-1.97-5.61ZM12 20a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />
    </svg>
  );
}

/** "Disappearing messages on: 7 days", centered in the timeline like WhatsApp. */
export function DisappearLine({ change, who, onOpen }) {
  return (
    <div className={`wa-sysline ${change.ms ? 'on' : 'off'}`}>
      <button onClick={onOpen} title="Change disappearing messages">
        <TimerIcon size={14} />
        <span>{who ? <><b>{who}</b> · </> : null}{change.label}</span>
      </button>
    </div>
  );
}

/** ⏱ 7d next to the chat name while disappearing messages are on. */
export function TimerBadge({ room }) {
  const ms = roomTimer(room);
  if (!ms) return null;
  const short = TIMERS.find((t) => t.ms === ms)?.short || timerLabel(ms);
  return (
    <span className="wa-timer-badge" title={`Disappearing messages: ${timerLabel(ms)}`}>
      <TimerIcon size={12} />{short}
    </span>
  );
}

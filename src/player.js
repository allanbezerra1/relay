// One audio player for the whole app, so a voice message keeps playing when you
// switch chats and the mini player in the sidebar can control it.
import { useSyncExternalStore } from 'react';
import { getPrefs, setPref } from './prefs.js';

const audio = new Audio();
audio.preload = 'metadata';
audio.volume = getPrefs().voiceVolume;

let state = { src: null, meta: null, playing: false, time: 0, duration: 0, rate: 1, volume: audio.volume };
const listeners = new Set();

function emit(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const sync = () => emit({
  playing: !audio.paused,
  time: audio.currentTime,
  duration: Number.isFinite(audio.duration) ? audio.duration : state.duration,
});
['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange'].forEach((e) => audio.addEventListener(e, sync));
audio.addEventListener('ended', () => { audio.currentTime = 0; sync(); emit({ playing: false }); });

export const player = {
  /** Play `src`, or toggle pause if it's already the current track. meta = { id, title, avatar, duration } */
  toggle(src, meta) {
    if (state.src === src) {
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
      return;
    }
    audio.src = src;
    audio.playbackRate = state.rate;
    emit({ src, meta, time: 0, duration: (meta?.duration || 0) });
    audio.play().catch(() => {});
  },
  seek(fraction) {
    const d = state.duration || audio.duration;
    if (!Number.isFinite(d) || !d) return;
    audio.currentTime = Math.max(0, Math.min(d, fraction * d));
    sync();
  },
  skip(seconds) {
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + seconds));
    sync();
  },
  setRate(rate) {
    audio.playbackRate = rate;
    emit({ rate });
  },
  /** 0–1; remembered for next time. */
  setVolume(v) {
    audio.volume = Math.max(0, Math.min(1, v));
    emit({ volume: audio.volume });
    setPref('voiceVolume', audio.volume);
  },
  stop() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    emit({ src: null, meta: null, playing: false, time: 0, duration: 0 });
  },
};

export function usePlayer() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}

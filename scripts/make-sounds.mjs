// Generates Relay's own interface and notification sounds (public/sounds/**.wav).
// Everything is synthesized here, so the sounds are original and ship under the project's license.
//   node scripts/make-sounds.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 44100;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sounds');

const hz = (note) => 440 * 2 ** ((note - 69) / 12); // MIDI note → frequency

// Instruments: [ratio, gain, decay multiplier] per partial.
const SOFT = [[1, 1, 1], [2, 0.18, 1.6], [3, 0.05, 2.4]];
const MARIMBA = [[1, 1, 1], [3.93, 0.28, 4], [9.2, 0.08, 7]];
const BELL = [[1, 1, 1], [2.76, 0.45, 1.5], [5.4, 0.22, 2.2], [8.93, 0.08, 3]];
const GLASS = [[1, 1, 1], [2.32, 0.3, 1.3], [4.25, 0.15, 1.8], [6.63, 0.06, 2.6]];

function render(length, notes) {
  const buf = new Float32Array(Math.ceil(length * RATE));
  for (const { at = 0, f, dur = 0.5, amp = 1, inst = SOFT, attack = 0.004, glide = 0 } of notes) {
    const start = Math.floor(at * RATE);
    const n = Math.min(buf.length - start, Math.ceil(dur * 2.5 * RATE));
    for (const [ratio, gain, dk] of inst) {
      let phase = 0;
      for (let i = 0; i < n; i++) {
        const t = i / RATE;
        const freq = f * ratio * (1 + glide * Math.min(1, t / 0.08));
        phase += (2 * Math.PI * freq) / RATE;
        const env = Math.min(1, t / attack) * Math.exp((-t * dk * 4.6) / dur);
        buf[start + i] += Math.sin(phase) * gain * amp * env;
      }
    }
  }
  // Fade the tail out and normalise.
  const fade = Math.floor(0.03 * RATE);
  for (let i = 0; i < fade; i++) buf[buf.length - 1 - i] *= i / fade;
  const peak = buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  return buf.map((v) => (v / peak) * 0.85);
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const SOUNDS = {
  // Interface
  'interface/sound_send': render(0.32, [{ f: hz(79), dur: 0.12, glide: 0.35, amp: 0.9 }, { at: 0.05, f: hz(86), dur: 0.16, amp: 0.5 }]),
  'interface/sound_receive': render(0.55, [{ f: hz(81), dur: 0.22, inst: MARIMBA }, { at: 0.09, f: hz(88), dur: 0.3, inst: MARIMBA, amp: 0.8 }]),
  'interface/sound_push': render(0.4, [{ f: hz(84), dur: 0.25, inst: MARIMBA }]),
  'interface/sound_react_like': render(0.3, [{ f: hz(76), dur: 0.1, glide: 0.25 }, { at: 0.06, f: hz(83), dur: 0.14, amp: 0.7 }]),
  'interface/sound_react_heart': render(0.5, [{ f: hz(79), dur: 0.18, inst: GLASS }, { at: 0.1, f: hz(84), dur: 0.26, inst: GLASS }]),
  'interface/sound_react_haha': render(0.45, [0, 0.06, 0.12].map((at, i) => ({ at, f: hz(84 + i * 3), dur: 0.1, inst: MARIMBA, amp: 1 - i * 0.15 }))),
  'interface/sound_react_emphasize': render(0.45, [{ f: hz(91), dur: 0.28, inst: BELL }]),
  'interface/sound_react_question': render(0.45, [{ f: hz(79), dur: 0.12 }, { at: 0.1, f: hz(86), dur: 0.2, glide: 0.06 }]),
  'interface/sound_react_dislike': render(0.45, [{ f: hz(79), dur: 0.14 }, { at: 0.1, f: hz(72), dur: 0.22, glide: -0.04 }]),
  // Notifications
  'notifications/chime': render(1.2, [76, 79, 84].map((n, i) => ({ at: i * 0.11, f: hz(n), dur: 0.6, inst: BELL, amp: 0.8 + i * 0.1 }))),
  'notifications/glass': render(1.2, [{ f: hz(88), dur: 0.7, inst: GLASS }, { at: 0.14, f: hz(95), dur: 0.8, inst: GLASS, amp: 0.7 }]),
  'notifications/drop': render(0.6, [{ f: hz(74), dur: 0.2, glide: 0.6, amp: 0.9 }, { at: 0.12, f: hz(86), dur: 0.25, inst: MARIMBA, amp: 0.5 }]),
  'notifications/marimba': render(1, [72, 76, 79, 84].map((n, i) => ({ at: i * 0.08, f: hz(n), dur: 0.35, inst: MARIMBA }))),
  'notifications/harp': render(1.4, [67, 71, 74, 79, 83, 86].map((n, i) => ({ at: i * 0.055, f: hz(n), dur: 0.7, amp: 0.6 + i * 0.07 }))),
  'notifications/bell': render(1.6, [{ f: hz(76), dur: 1, inst: BELL }, { at: 0.02, f: hz(64), dur: 1.1, inst: SOFT, amp: 0.4 }]),
};

for (const [name, samples] of Object.entries(SOUNDS)) {
  const file = join(OUT, `${name}.wav`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, wav(samples));
  console.log(file.replace(OUT + '/', ''), `${(samples.length / RATE).toFixed(2)}s`);
}

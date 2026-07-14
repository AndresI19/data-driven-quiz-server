// Subtle synthesized sound effects (Web Audio, no assets). Ported verbatim.
import { DB } from '../runtime/db.js';

let AC: AudioContext | null = null;
let master: GainNode | null = null;

export function setVolume(): void {
  if (master) {
    try {
      master.gain.value = (DB.settings.volume / 100) * 1.8;
    } catch (e) {}
  }
}
export function audioInit(): void {
  if (!AC) {
    try {
      AC = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      )();
      master = AC.createGain();
      master.connect(AC.destination);
      setVolume();
    } catch (e) {
      AC = null;
      return;
    }
  }
  if (AC && AC.state === 'suspended') {
    try {
      AC.resume();
    } catch (e) {}
  }
}
function blip(freqs: number[], dur: number, type?: OscillatorType, peak?: number): void {
  if (!AC || DB.settings.muted || DB.settings.volume <= 0) return;
  const t0 = AC.currentTime;
  freqs.forEach((f, i) => {
    const o = AC!.createOscillator();
    const g = AC!.createGain();
    o.type = type || 'sine';
    o.frequency.value = f;
    const s = t0 + i * 0.07;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.linearRampToValueAtTime(peak || 0.2, s + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
    o.connect(g);
    g.connect(master!);
    o.start(s);
    o.stop(s + dur + 0.03);
  });
}
export function sndCorrect(): void {
  blip([660, 990], 0.16, 'sine', 0.26);
}
export function sndWrong(): void {
  blip([200, 130], 0.2, 'triangle', 0.26);
}
export function sndFlip(): void {
  blip([520], 0.05, 'sine', 0.14);
}
function noiseBurst(dur: number, peak?: number): void {
  if (!AC || DB.settings.muted || DB.settings.volume <= 0) return;
  const n = Math.floor(AC.sampleRate * dur);
  const buf = AC.createBuffer(1, n, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = AC.createBufferSource();
  src.buffer = buf;
  const g = AC.createGain();
  const t0 = AC.currentTime;
  g.gain.setValueAtTime(peak || 0.2, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(g);
  g.connect(master!);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}
export function sndWater(): void {
  audioInit();
  blip([260, 150], 0.12, 'sine', 0.28);
  setTimeout(() => blip([230, 120], 0.13, 'sine', 0.26), 135);
}
export function sndPlant(): void {
  audioInit();
  noiseBurst(0.18, 0.24);
  blip([120, 80], 0.13, 'triangle', 0.22);
}
export function sndDig(): void {
  audioInit();
  noiseBurst(0.14, 0.3);
  blip([90, 60], 0.12, 'square', 0.18);
}

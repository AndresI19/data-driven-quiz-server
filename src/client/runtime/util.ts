// Small shared helpers — ports of the original inline utilities. `esc` here is the RUNTIME
// escaper (escapes & < > " only, not ' ) used for dynamic strings; it is intentionally
// distinct from the card-transform esc used when rendering authored card HTML.
import { S } from './state.js';

const ESC_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export function shuffle<T>(a: T[]): T[] {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function esc(s: unknown): string {
  return String(s).replace(/[&<>"]/g, (m) => ESC_MAP[m]);
}

export function norm(s: unknown): string {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

export function setKey(fn: ((e: KeyboardEvent) => void) | null): void {
  if (S.keyHandler) window.removeEventListener('keydown', S.keyHandler);
  S.keyHandler = fn;
  if (fn) window.addEventListener('keydown', fn);
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

export function fmtSpeed(v: number): string {
  return v > 0 ? v.toFixed(1) + '×' : 'off';
}

export const cssVar = (n: string): string =>
  (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim();

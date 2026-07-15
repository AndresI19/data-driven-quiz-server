import { setup } from '../pages/home.js';
// Pause (freeze both timers + the timeout) and the diagram zoom overlay. Ported verbatim.
import { S } from '../runtime/state.js';
import { setKey } from '../runtime/util.js';
import { resumeTicking, stopTicker } from './timer.js';

export function pauseGame(): void {
  if (!S.running || S.pausedAt) return;
  S.pausedAt = Date.now();
  S.pausedFocus = document.activeElement;
  stopTicker();
  S.pausedKey = S.keyHandler;
  setKey(null);
  const ov = document.createElement('div');
  ov.id = 'pauseov';
  ov.className = 'pauseov';
  ov.innerHTML = `<div class="pausebox"><div class="pausetitle">Paused</div><div class="tiny" style="margin-bottom:18px">Timer stopped · take your time</div><div class="actions center"><button class="btn ghost" id="quitbtn">Quit to menu</button><button class="btn primary" id="resumebtn">Resume &nbsp;<kbd>P</kbd></button></div></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#resumebtn')!.addEventListener('click', unpauseGame);
  ov.querySelector('#quitbtn')!.addEventListener('click', quitToMenu);
}
export function quitToMenu(): void {
  S.pausedKey = null;
  hidePause();
  setup();
}
export function openZoom(svgHtml: string): void {
  closeZoom();
  const z = document.createElement('div');
  z.id = 'zoomov';
  z.className = 'zoomov';
  z.innerHTML = `<div class="zoombox"><button class="zoomclose" id="zoomclose" title="close">×</button><div class="zoomsvg">${svgHtml}</div></div>`;
  document.body.appendChild(z);
  z.addEventListener('click', (e) => {
    if (e.target === z) closeZoom();
  });
  z.querySelector('#zoomclose')!.addEventListener('click', closeZoom);
}
export function closeZoom(): void {
  const z = document.getElementById('zoomov');
  if (z) z.remove();
}
export function unpauseGame(): void {
  if (!S.pausedAt) return;
  const delta = Date.now() - S.pausedAt;
  S.cardStart += delta;
  if (S.answeredAt) S.answeredAt += delta;
  S.pausedAt = 0;
  const ov = document.getElementById('pauseov');
  if (ov) ov.remove();
  setKey(S.pausedKey);
  S.pausedKey = null;
  if (S.pausedFocus && (S.pausedFocus as HTMLElement).focus && document.contains(S.pausedFocus)) {
    const f = S.pausedFocus as HTMLElement;
    setTimeout(() => f.focus(), 0);
  }
  S.pausedFocus = null;
  resumeTicking();
}
export function hidePause(): void {
  const ov = document.getElementById('pauseov');
  if (ov) ov.remove();
  S.pausedAt = 0;
}
/**
 * Remove EVERY transient full-screen overlay — pause, peek-back and diagram zoom — and clear the
 * paused flag. Each of these is `position:fixed; inset:0` and clickable, and each used to rely
 * entirely on its own close button / Escape to go away. A navigation that bypassed that path (a
 * browser Back firing popstate, or any re-render) left the overlay orphaned on top of the next page,
 * where it silently swallowed every click — no handler, no error, no network. Every navigation entry
 * (route, setup, gardenPage) now calls this first, so no overlay can outlive the page that spawned it.
 */
export function dismissTransients(): void {
  for (const id of ['pauseov', 'peekov', 'zoomov']) document.getElementById(id)?.remove();
  S.pausedAt = 0;
}

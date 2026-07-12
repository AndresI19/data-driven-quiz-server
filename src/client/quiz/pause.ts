// Pause (freeze both timers + the timeout) and the diagram zoom overlay. Ported verbatim.
import { S } from '../runtime/state.js';
import { setKey } from '../runtime/util.js';
import { setup } from '../pages/home.js';
import { stopTicker, resumeTicking } from './timer.js';

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

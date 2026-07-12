// Full-screen garden background: a fixed layer behind the whole app. Shown on the garden and home
// pages (when the active garden has a background selected), hidden everywhere else (e.g. the quiz).
import { DB } from '../runtime/db.js';
import { BG_URL } from './catalog.js';
import { setEffect } from './particles.js';

let el: HTMLDivElement | null = null;

export function mountScreenBg(): void {
  el = document.createElement('div');
  el.className = 'screenbg';
  document.body.appendChild(el);
}

/** Ambience toggle: full-screen background + falling-particle effect (garden + home), or clear it. */
export function setScreenBg(show: boolean): void {
  setEffect(show);
  const id = show ? DB.garden.bg : null;
  // Neutralize the UI (a tad greyer) over a dark background scene.
  document.body.classList.toggle('ambient', !!id);
  if (!el) return;
  if (id) {
    el.style.backgroundImage = `url(${BG_URL(id)})`;
    el.classList.add('on');
  } else {
    el.style.backgroundImage = '';
    el.classList.remove('on');
  }
}

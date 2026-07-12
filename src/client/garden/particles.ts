// Falling-particle weather effects (leaves / petals / snow / rain), swept NE → SW. A fixed
// full-screen overlay (pointer-events off) spawns many sprite particles; each tumbles through its
// spritesheet frames while a shared fall keyframe carries it down-and-left. Shown on the garden and
// home pages (when the active garden has an effect selected), hidden elsewhere.
import { DB } from '../runtime/db.js';
import { EFFECTS, FX_URL } from './catalog.js';

const COUNT = 60;
let layer: HTMLDivElement | null = null;

export function mountParticles(): void {
  layer = document.createElement('div');
  layer.className = 'fxlayer';
  document.body.appendChild(layer);
}

/** Per-effect base fall time (s): rain fast; everything else 40% slower than before. */
function baseFall(id: string): number {
  return id === 'rain' ? 1.5 : id === 'snow' ? 9.1 : 6.3;
}

export function setEffect(show: boolean): void {
  if (!layer) return;
  const id = show ? DB.garden.fx : null;
  const fx = id ? EFFECTS.find((e) => e.id === id) : null;
  if (!fx) {
    layer.classList.remove('on');
    layer.innerHTML = '';
    return;
  }
  const url = FX_URL(fx.id);
  const base = baseFall(fx.id);
  let html = '';
  for (let i = 0; i < COUNT; i++) {
    const left = (-12 + Math.random() * 140).toFixed(1); // extra to the right — they drift left
    const dur = (base * (0.7 + Math.random() * 0.6)).toFixed(2);
    const delay = (-Math.random() * base * 1.3).toFixed(2); // negative → already mid-fall on load
    const scale = (1.4 + Math.random() * 1.0).toFixed(2);
    const spin = (fx.dur * (0.85 + Math.random() * 0.3)).toFixed(2);
    html +=
      `<span class="fxp" style="left:${left}%;animation-duration:${dur}s;animation-delay:${delay}s">` +
      `<span class="fxp-i" style="width:${fx.fw}px;height:${fx.fh}px;background-image:url(${url});` +
      `animation:fx-spin-${fx.id} ${spin}s steps(${fx.n}) infinite;transform:scale(${scale})"></span></span>`;
  }
  layer.innerHTML = html;
  layer.classList.add('on');
}

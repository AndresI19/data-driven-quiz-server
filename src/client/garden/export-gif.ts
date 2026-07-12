// Export the garden as a small animated GIF (~5s loop). Element boxes are static; only spritesheet
// FRAMES advance. Rather than relying on the browser to advance CSS animations during capture
// (which fails headless / under reduced-motion), we compute each sprite's frame deterministically
// from a virtual time and its animation delay — so the GIF is animated by construction. The
// selected background is baked in behind everything. Encoded with the bundled gifenc.
import { app } from '../runtime/data.js';
import { DB } from '../runtime/db.js';
import { BG_URL, EFFECTS, FX_URL } from './catalog.js';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

const FRAMES = 25; // 25 * 200ms = 5s loop
const DELAY = 200; // ms per GIF frame (gifenc units are ms)
const SCALE = 0.6; // downscale the 800px board for a small file
const HEADROOM = 118; // px above the board to include tall trees
const FX_COUNT = 34; // particles synthesized into the GIF when an effect is active
const FX_DRIFT = 0.371; // horizontal:vertical travel ratio, matching the fx-fall keyframe (−46vh / 124vh)

// A small deterministic PRNG so the particle field is identical on every frame (the loop replays it).
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), seed | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
interface FxParticle {
  startX: number;
  yPhase: number;
  spinPhase: number;
  scale: number;
  kFall: number; // full falls per GIF loop (integer ⇒ seamless wrap while off-canvas)
  kSpin: number; // full sprite-spins per GIF loop (integer ⇒ seamless)
}

// Per animation class: [frames, duration seconds] — matches the CSS keyframes.
const ANIM: Record<string, [number, number]> = {
  'anim-tree-pine': [16, 1.7],
  'anim-tree-spruce': [25, 2.6],
  'anim-badger': [22, 2.2],
  'anim-boar': [7, 0.9],
  'anim-stag': [24, 2.0],
  'anim-wolf': [4, 0.8],
};

interface DrawItem {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  img?: HTMLImageElement; // plain <img> (static)
  url?: string; // spritesheet background url
  fw?: number;
  fh?: number;
  n?: number; // animation frame count (undefined → static, draw frame 0)
  dur?: number; // animation duration seconds
  delay?: number; // animation-delay seconds (usually negative)
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}

export async function exportGardenGif(): Promise<void> {
  const board = app.querySelector('.gboard') as HTMLElement | null;
  if (!board) return;
  const btn = document.getElementById('gexport');
  const btnText = btn?.textContent;
  if (btn) {
    btn.textContent = '⏳ rendering…';
    (btn as HTMLButtonElement).disabled = true;
  }
  try {
    const br = board.getBoundingClientRect();
    const originX = br.left,
      originY = br.top - HEADROOM;
    const capW = br.width,
      capH = br.height + HEADROOM;
    const cw = Math.round(capW * SCALE),
      ch = Math.round(capH * SCALE);

    const garts = Array.prototype.slice
      .call(board.querySelectorAll('.gart'))
      .sort((a: HTMLElement, b: HTMLElement) => +a.style.zIndex - +b.style.zIndex);
    const items: DrawItem[] = [];
    const urls = new Set<string>();
    garts.forEach((g: HTMLElement) => {
      g.querySelectorAll('img,.gtreef,.ganimf').forEach((elRaw) => {
        const el = elRaw as HTMLElement;
        const r = el.getBoundingClientRect();
        const it: DrawItem = {
          dx: (r.left - originX) * SCALE,
          dy: (r.top - originY) * SCALE,
          dw: r.width * SCALE,
          dh: r.height * SCALE,
        };
        if (el.tagName === 'IMG') {
          it.img = el as HTMLImageElement;
        } else {
          const bg = el.style.backgroundImage;
          it.url = bg.slice(bg.indexOf('(') + 1, bg.lastIndexOf(')')).replace(/["']/g, '');
          it.fw = parseInt(el.style.width);
          it.fh = parseInt(el.style.height);
          const cls = [...el.classList].find((c) => ANIM[c]);
          if (cls) {
            [it.n, it.dur] = ANIM[cls];
            it.delay = parseFloat(getComputedStyle(el).animationDelay) || 0;
          }
          urls.add(it.url);
        }
        items.push(it);
      });
    });

    const sheetById: Record<string, HTMLImageElement | null> = {};
    await Promise.all([...urls].map(async (u) => (sheetById[u] = await loadImage(u))));
    const bgImg = DB.garden.bg ? await loadImage(BG_URL(DB.garden.bg)) : null;

    // Active particle effect: load its strip and precompute a deterministic field over the canvas.
    const fx = DB.garden.fx ? EFFECTS.find((e) => e.id === DB.garden.fx) : null;
    const fxSheet = fx ? await loadImage(FX_URL(fx.id)) : null;
    const fxMargin = 52; // px of off-canvas runway so the loop wrap is never visible
    const fxTravel = ch + 2 * fxMargin;
    const fxParts: FxParticle[] = [];
    if (fx && fxSheet) {
      for (let i = 0; i < FX_COUNT; i++) {
        const rnd = mulberry32((i * 2654435761) >>> 0);
        fxParts.push({
          startX: -cw * 0.15 + rnd() * cw * 1.4,
          yPhase: rnd(),
          spinPhase: rnd(),
          scale: 1.0 + rnd() * 0.9,
          kFall: 1 + (i % 3), // three speed tiers, all dividing the loop
          kSpin: 6 + Math.floor(rnd() * 6),
        });
      }
    }

    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = false;

    const drawBg = (): void => {
      if (bgImg) {
        const s = Math.max(cw / bgImg.width, ch / bgImg.height);
        const w = bgImg.width * s,
          h = bgImg.height * s;
        ctx.drawImage(bgImg, (cw - w) / 2, (ch - h) / 2, w, h);
      } else {
        ctx.fillStyle = '#e9ecf4';
        ctx.fillRect(0, 0, cw, ch);
      }
    };

    const gif = GIFEncoder();
    for (let f = 0; f < FRAMES; f++) {
      const t = (f * DELAY) / 1000; // virtual time, seconds
      drawBg();
      for (const it of items) {
        try {
          if (it.img) {
            ctx.drawImage(it.img, it.dx, it.dy, it.dw, it.dh);
          } else {
            const sheet = sheetById[it.url!];
            if (!sheet) continue;
            let sx = 0;
            if (it.n && it.dur) {
              // progress through the loop at virtual time t (delay is negative → advances phase)
              let prog = ((t - it.delay!) / it.dur) % 1;
              if (prog < 0) prog += 1;
              sx = Math.floor(prog * it.n) * it.fw!;
            }
            ctx.drawImage(sheet, sx, 0, it.fw!, it.fh!, it.dx, it.dy, it.dw, it.dh);
          }
        } catch (e) {}
      }
      // Particle effect on top of the scene (mirrors the .fxlayer z-index above the board).
      if (fx && fxSheet) {
        const norm = f / FRAMES; // t / T, normalized loop position in [0,1)
        for (const p of fxParts) {
          let prog = (norm * p.kFall + p.yPhase) % 1;
          if (prog < 0) prog += 1;
          const y = -fxMargin + prog * fxTravel;
          const x = p.startX - FX_DRIFT * (prog * fxTravel);
          const dw = fx.fw * p.scale * SCALE,
            dh = fx.fh * p.scale * SCALE;
          let sp = (norm * p.kSpin + p.spinPhase) % 1;
          if (sp < 0) sp += 1;
          const frame = Math.min(fx.n - 1, Math.floor(sp * fx.n));
          try {
            ctx.drawImage(fxSheet, frame * fx.fw, 0, fx.fw, fx.fh, x, y, dw, dh);
          } catch (e) {}
        }
      }
      const { data } = ctx.getImageData(0, 0, cw, ch);
      const palette = quantize(data, 256);
      const index = applyPalette(data, palette);
      gif.writeFrame(index, cw, ch, f === 0 ? { palette, delay: DELAY, repeat: 0 } : { palette, delay: DELAY });
    }
    gif.finish();

    const blob = new Blob([gif.bytes() as unknown as BlobPart], { type: 'image/gif' });
    const a = document.createElement('a');
    a.download = 'my-garden.gif';
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } finally {
    if (btn) {
      btn.textContent = btnText || '🎬 GIF';
      (btn as HTMLButtonElement).disabled = false;
    }
  }
}

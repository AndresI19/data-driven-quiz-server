import { GIFEncoder, applyPalette, quantize } from 'gifenc';
// Export the garden as an animated GIF at the size and resolution it is shown on screen. Element
// boxes are static; only spritesheet FRAMES advance. Rather than relying on the browser to advance
// CSS animations during capture (which fails headless / under reduced-motion), we compute each
// sprite's frame deterministically from a virtual time and its animation delay — so the GIF is
// animated by construction. The selected background is baked in behind everything. Encoded with the
// bundled gifenc.
//
// Both dimensions of the output are set by the ART, and the byte budget is only a ceiling checked
// against them — never a quota to fill:
//
//   length     — exactly the slowest sprite animation (LOOP_SECONDS), so nothing is cut off mid-cycle
//   resolution — scale 1, where the sprites' own pixels are all already on the canvas (SCALE_STEPS)
//   framerate  — 50fps, the fastest a GIF can honestly play (DELAY)
//
// Only the scale is negotiable, and only downward, if a costly background would push that loop past
// the cap. Expect a result comfortably UNDER the cap on a plain garden, and do not "fix" that by
// inflating anything: this art has a hard detail ceiling, so the leftover allowance cannot buy
// anything a viewer would see.
import { app } from '../runtime/data.js';
import { DB } from '../runtime/db.js';
import { BG_URL, EFFECTS, FX_URL } from './catalog.js';

const SIZE_CAP = 10 * 1024 * 1024; // what a "typical" GIF is expected to fit inside (Discord-free sized)
const BUDGET = Math.floor(SIZE_CAP * 0.9); // the ceiling to stay under — not a quota to fill (see below)
// 20ms = 2 centiseconds = exactly 50fps, and the fastest a GIF can honestly play: delay is stored in
// whole centiseconds, so 1cs is floored to 10cs by most viewers and anything between the steps rounds
// and drifts. 45fps (2.2cs) is not representable; 50 is its nearest achievable neighbour.
const DELAY = 20;
const PROBE_FRAMES = 4; // frames encoded to measure the loop's cost before committing to a scale
/**
 * Resolution is capped by the SOURCE ART, not by the byte budget.
 *
 * The tiles are 32×32 pngs the page already blows up to 80×80 (2.5×, nearest-neighbour), so at scale
 * 1 every pixel the sprites own is already on the canvas — drawing them larger just makes bigger
 * blocks: no new detail, four times the bytes. Only the background has anything left (a 1152×648 png
 * that cover-fits 800×566 at 0.87×, native at ~1.15×) — but a full-length loop at that scale runs past
 * the cap, and the loop is not something we trade away. So 1 is the top step; the rest are a fallback
 * for a background so costly that even 1 will not fit.
 */
const SCALE_STEPS = [1, 0.85, 0.7];
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
/**
 * The loop lasts exactly as long as the SLOWEST animation above, so every sprite gets to play through
 * at least once instead of being cut off mid-cycle. Length is therefore a property of the ART, not of
 * the byte budget — derived here so that adding a slower animation to ANIM lengthens the GIF on its
 * own, with no constant to remember.
 *
 * Only the slowest sprite wraps perfectly. The others divide into 2.6s unevenly and so still step at
 * the loop point; a loop seamless for ALL of them would have to run the LCM of 0.8/0.9/1.7/2.0/2.2/2.6
 * seconds, which is minutes long. Showing every animation in full is the achievable half of that.
 */
const LOOP_SECONDS = Math.max(...Object.values(ANIM).map(([, dur]) => dur)); // 2.6s — the spruce
const FRAMES = Math.round((LOOP_SECONDS * 1000) / DELAY); // 130 frames @ 50fps

// Geometry is stored UNSCALED (capture-space px, origin at the capture's top-left) and multiplied by
// the scale at draw time. That keeps the scale a free variable, so a budget retry at a smaller scale
// costs nothing — no second walk of the DOM.
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

/** Let the browser breathe: repaint the progress label and keep the tab responsive between frames. */
function yieldToBrowser(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export async function exportGardenGif(): Promise<void> {
  const board = app.querySelector('.gboard') as HTMLElement | null;
  if (!board) return;
  const btn = document.getElementById('gexport');
  const btnText = btn?.textContent;
  const say = (msg: string): void => {
    if (btn) btn.textContent = msg;
  };
  if (btn) {
    say('⏳ rendering…');
    (btn as HTMLButtonElement).disabled = true;
  }
  try {
    const br = board.getBoundingClientRect();
    const originX = br.left;
    const originY = br.top - HEADROOM;
    const capW = br.width;
    const capH = br.height + HEADROOM;

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
          dx: r.left - originX,
          dy: r.top - originY,
          dw: r.width,
          dh: r.height,
        };
        if (el.tagName === 'IMG') {
          it.img = el as HTMLImageElement;
        } else {
          const bg = el.style.backgroundImage;
          it.url = bg.slice(bg.indexOf('(') + 1, bg.lastIndexOf(')')).replace(/["']/g, '');
          it.fw = Number.parseInt(el.style.width);
          it.fh = Number.parseInt(el.style.height);
          const cls = [...el.classList].find((c) => ANIM[c]);
          if (cls) {
            [it.n, it.dur] = ANIM[cls];
            it.delay = Number.parseFloat(getComputedStyle(el).animationDelay) || 0;
          }
          urls.add(it.url);
        }
        items.push(it);
      });
    });

    const sheetById: Record<string, HTMLImageElement | null> = {};
    await Promise.all([...urls].map(async (u) => (sheetById[u] = await loadImage(u))));
    const bgImg = DB.garden.bg ? await loadImage(BG_URL(DB.garden.bg)) : null;
    const fx = DB.garden.fx ? EFFECTS.find((e) => e.id === DB.garden.fx) : null;
    const fxSheet = fx ? await loadImage(FX_URL(fx.id)) : null;
    const fxMargin = 52; // px of off-canvas runway so the loop wrap is never visible

    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;

    /** Size the canvas for a scale and rebuild the particle field to match it. */
    const setup = (scale: number): { cw: number; ch: number; fxParts: FxParticle[] } => {
      const cw = Math.round(capW * scale);
      const ch = Math.round(capH * scale);
      cv.width = cw;
      cv.height = ch;
      ctx.imageSmoothingEnabled = false; // reset by a canvas resize — pixel art must stay crisp
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
      return { cw, ch, fxParts };
    };

    /** Paint one frame of an `frames`-long loop. Particle phases normalize by `frames`, so any loop
     *  length stays seamless; sprite phases run off the virtual clock exactly as before. */
    const drawFrame = (
      f: number,
      frames: number,
      scale: number,
      cw: number,
      ch: number,
      fxParts: FxParticle[],
    ): void => {
      const t = (f * DELAY) / 1000; // virtual time, seconds
      if (bgImg) {
        const s = Math.max(cw / bgImg.width, ch / bgImg.height);
        const w = bgImg.width * s;
        const h = bgImg.height * s;
        ctx.drawImage(bgImg, (cw - w) / 2, (ch - h) / 2, w, h);
      } else {
        ctx.fillStyle = '#e9ecf4';
        ctx.fillRect(0, 0, cw, ch);
      }
      for (const it of items) {
        try {
          const dx = it.dx * scale;
          const dy = it.dy * scale;
          const dw = it.dw * scale;
          const dh = it.dh * scale;
          if (it.img) {
            ctx.drawImage(it.img, dx, dy, dw, dh);
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
            ctx.drawImage(sheet, sx, 0, it.fw!, it.fh!, dx, dy, dw, dh);
          }
        } catch {}
      }
      // Particle effect on top of the scene (mirrors the .fxlayer z-index above the board).
      if (fx && fxSheet) {
        const fxTravel = ch + 2 * fxMargin;
        const norm = f / frames; // t / T, normalized loop position in [0,1)
        for (const p of fxParts) {
          let prog = (norm * p.kFall + p.yPhase) % 1;
          if (prog < 0) prog += 1;
          const y = -fxMargin + prog * fxTravel;
          const x = p.startX - FX_DRIFT * (prog * fxTravel);
          const dw = fx.fw * p.scale * scale;
          const dh = fx.fh * p.scale * scale;
          let sp = (norm * p.kSpin + p.spinPhase) % 1;
          if (sp < 0) sp += 1;
          const frame = Math.min(fx.n - 1, Math.floor(sp * fx.n));
          try {
            ctx.drawImage(fxSheet, frame * fx.fw, 0, fx.fw, fx.fh, x, y, dw, dh);
          } catch {}
        }
      }
    };

    /** Encode the current canvas into `gif` as one frame. */
    const encodeFrame = (
      gif: ReturnType<typeof GIFEncoder>,
      cw: number,
      ch: number,
      first: boolean,
    ): void => {
      const { data } = ctx.getImageData(0, 0, cw, ch);
      const palette = quantize(data, 256);
      const index = applyPalette(data, palette);
      gif.writeFrame(index, cw, ch, first ? { palette, delay: DELAY, repeat: 0 } : { palette, delay: DELAY });
    };

    /**
     * What would the whole loop cost at this scale? Encode a handful of frames sampled across it and
     * measure — compressibility swings wildly with the chosen background (a photographic one runs ~8×
     * the bytes of a flat one), so a measurement beats any formula. The probe's total includes the
     * file header, making the per-frame figure a touch pessimistic: it errs under the cap, never over.
     */
    const probeBytes = async (
      scale: number,
      cw: number,
      ch: number,
      fxParts: FxParticle[],
    ): Promise<number> => {
      const probe = GIFEncoder();
      for (let i = 0; i < PROBE_FRAMES; i++) {
        drawFrame(Math.round((i * FRAMES) / PROBE_FRAMES), FRAMES, scale, cw, ch, fxParts);
        encodeFrame(probe, cw, ch, i === 0);
        await yieldToBrowser();
      }
      probe.finish();
      return (probe.bytes().length / PROBE_FRAMES) * FRAMES; // projected size of the full loop
    };

    // The loop length is fixed by the ART (see FRAMES), not by the budget — a shorter loop would cut
    // the slowest sprite off mid-animation, which is the one thing we will not trade away. So the only
    // free variable left is scale: take the first (largest) one whose full loop fits under the cap.
    say('⏳ measuring…');
    let scale = SCALE_STEPS[SCALE_STEPS.length - 1]; // the smallest, as a floor if nothing else fits
    for (const s of SCALE_STEPS) {
      const d = setup(s);
      if ((await probeBytes(s, d.cw, d.ch, d.fxParts)) <= BUDGET) {
        scale = s;
        break;
      }
    }
    const frames = FRAMES;
    const { cw, ch, fxParts } = setup(scale); // fresh canvas for the real pass

    const gif = GIFEncoder();
    for (let f = 0; f < frames; f++) {
      drawFrame(f, frames, scale, cw, ch, fxParts);
      encodeFrame(gif, cw, ch, f === 0);
      if (f % 5 === 0) {
        say(`⏳ ${Math.round((f / frames) * 100)}%`);
        await yieldToBrowser(); // repaint the label; keeps the tab from locking up at full resolution
      }
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

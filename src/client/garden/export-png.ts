// Composite the rendered board to a canvas and download it (static — first frame of any
// animation). Ported verbatim.
import { app } from '../runtime/data.js';

interface DrawItem {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  img?: HTMLImageElement;
  url?: string;
  fw?: number;
  fh?: number;
}

export function exportGarden(): void {
  const board = app.querySelector('.gboard');
  if (!board) return;
  const S = 2,
    br = board.getBoundingClientRect();
  const garts = Array.prototype.slice
    .call(board.querySelectorAll('.gart'))
    .sort((a: HTMLElement, b: HTMLElement) => +a.style.zIndex - +b.style.zIndex);
  const items: DrawItem[] = [],
    urls: Record<string, number> = {};
  garts.forEach((g: HTMLElement) => {
    g.querySelectorAll('img,.gtreef,.ganimf').forEach((el) => {
      const r = el.getBoundingClientRect();
      const it: DrawItem = {
        dx: (r.left - br.left) * S,
        dy: (r.top - br.top) * S,
        dw: r.width * S,
        dh: r.height * S,
      };
      if (el.tagName === 'IMG') {
        it.img = el as HTMLImageElement;
      } else {
        const bg = (el as HTMLElement).style.backgroundImage;
        it.url = bg.slice(bg.indexOf('(') + 1, bg.lastIndexOf(')')).replace(/["']/g, '');
        it.fw = parseInt((el as HTMLElement).style.width);
        it.fh = parseInt((el as HTMLElement).style.height);
        urls[it.url] = 1;
      }
      items.push(it);
    });
  });
  let minX = 1e9,
    minY = 1e9,
    maxX = -1e9,
    maxY = -1e9;
  items.forEach((it) => {
    minX = Math.min(minX, it.dx);
    minY = Math.min(minY, it.dy);
    maxX = Math.max(maxX, it.dx + it.dw);
    maxY = Math.max(maxY, it.dy + it.dh);
  });
  const pad = 10 * S,
    ox = -minX + pad,
    oy = -minY + pad;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(maxX - minX + 2 * pad);
  cv.height = Math.ceil(maxY - minY + 2 * pad);
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const draw = (): void => {
    items.forEach((it) => {
      try {
        if (it.img) ctx.drawImage(it.img, it.dx + ox, it.dy + oy, it.dw, it.dh);
        else if (loaded[it.url!])
          ctx.drawImage(loaded[it.url!], 0, 0, it.fw!, it.fh!, it.dx + ox, it.dy + oy, it.dw, it.dh);
      } catch (e) {}
    });
    cv.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.download = 'my-garden.png';
      a.href = URL.createObjectURL(b);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  };
  const loaded: Record<string, HTMLImageElement> = {};
  const keys = Object.keys(urls);
  let pend = keys.length;
  if (!pend) {
    draw();
    return;
  }
  keys.forEach((u) => {
    const im = new Image();
    im.onload = () => {
      loaded[u] = im;
      if (--pend === 0) draw();
    };
    im.onerror = () => {
      if (--pend === 0) draw();
    };
    im.src = u;
  });
}

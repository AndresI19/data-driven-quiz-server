// The seven quiz modes: recall (FB), identify (BF), fill-in (CZ), match (MA), multi-select (MS),
// inverse (IV), and label-the-YAML (DM). Ported verbatim; module globals now live on S and each
// function aliases `const ses = S.ses!` so its body reads exactly like the original.
import { app, CATS, MULTIPOOL } from '../runtime/data.js';
import { DB } from '../runtime/db.js';
import { S } from '../runtime/state.js';
import { esc, shuffle, norm, cssVar, setKey } from '../runtime/util.js';
import { answeredNow } from './timer.js';
import { record, dispute, distractors, czOK } from './grading.js';
import { grantReward, breakCombo } from '../garden/economy.js';
import { hud, navKey } from './engine.js';
import { advance } from './session.js';
import type { GameCard } from '../../shared/card-schema.js';

export function renderFB(c: GameCard): void {
  const ses = S.ses!;
  ses.answered = false;
  app.innerHTML = `<div class="wrap">${hud()}
    <div class="qcard">
      <span class="dir">recall</span>
      <span class="catchip">${esc(CATS[c.cat])}</span>
      <div class="topic">${esc(c.topic)}</div>
      <div id="ans">
        <div class="ptip">Write what you remember, then reveal to compare.</div>
        <div id="hintbox" class="hintbox" style="display:none"></div>
        <textarea id="recall" class="recall" placeholder="Type your answer…"></textarea>
      </div>
      <div class="actions" id="act">${DB.settings.hints && c.hint ? `<button class="btn ghost" id="hintbtn">Hint</button>` : ''}<button class="btn primary" id="reveal">Reveal answer &nbsp;<kbd>Ctrl+Enter</kbd></button></div>
    </div></div>`;
  const ta = app.querySelector('#recall') as HTMLTextAreaElement;
  setTimeout(() => ta.focus(), 30);
  const hb = app.querySelector('#hintbtn') as HTMLButtonElement | null;
  if (hb)
    hb.addEventListener('click', () => {
      const box = app.querySelector('#hintbox') as HTMLElement | null;
      if (!box) return;
      if (box.style.display === 'none') {
        box.textContent = '→ ' + c.hint;
        box.style.display = '';
        hb.textContent = 'Hide hint';
      } else {
        box.style.display = 'none';
        hb.textContent = 'Hint';
      }
    });
  function reveal(timedOut: boolean): void {
    if (ses.answered) return;
    answeredNow();
    const mine = ta.value.trim();
    app.querySelector('#ans')!.innerHTML = `
      <div class="compare">
        <div class="col mine"><div class="col-h">Your recall</div><div class="mine-body">${mine ? esc(mine) : '<span class="muted">(left blank)</span>'}</div></div>
        <div class="col real"><div class="col-h">Answer</div><div class="answer">${c.back}</div></div>
      </div>`;
    if (!mine) {
      record(c, false);
      const note = timedOut ? '⏱ Timed out (blank) — marked missed' : 'Left blank — marked missed';
      app.querySelector('#act')!.outerHTML = `<div class="grade-note bad">${note}</div><div class="actions"><button class="btn primary" id="next">Next <kbd>→</kbd></button></div>`;
      app.querySelector('#next')!.addEventListener('click', advance);
      setKey((e) => {
        navKey(e, true);
      });
    } else {
      app.querySelector('#act')!.outerHTML = `${timedOut ? `<div class="grade-note bad" style="margin-bottom:8px">⏱ Time’s up — grade yourself honestly</div>` : ''}<div class="grade">
        <button class="btn bad" id="miss">Not satisfied <kbd>2</kbd></button>
        <button class="btn good" id="got">Satisfied <kbd>1</kbd></button></div>`;
      app.querySelector('#got')!.addEventListener('click', () => {
        record(c, true);
        advance();
      });
      app.querySelector('#miss')!.addEventListener('click', () => {
        record(c, false);
        advance();
      });
    }
  }
  ses._onTimeout = () => reveal(true);
  app.querySelector('#reveal')!.addEventListener('click', () => reveal(false));
  setKey((e) => {
    if (e.target && (e.target as HTMLElement).classList && (e.target as HTMLElement).classList.contains('noteta')) return;
    if (navKey(e, false)) return;
    if (!ses.answered) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        reveal(false);
      }
    } else {
      const k = e.key.toLowerCase();
      if (k === '1' || k === 'g') {
        record(c, true);
        advance();
      } else if (k === '2' || k === 'm') {
        record(c, false);
        advance();
      }
    }
  });
}

export function renderBF(c: GameCard): void {
  const ses = S.ses!;
  ses.answered = false;
  const extras = (c.mc || []).map((s) => ({ topic: s }));
  const seen = new Set([c.topic]);
  const pool = shuffle((distractors(c, 7) as { topic: string }[]).concat(extras))
    .filter((o) => {
      if (seen.has(o.topic)) return false;
      seen.add(o.topic);
      return true;
    })
    .slice(0, 7);
  const opts = shuffle(pool.concat(c));
  const L = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const btns = opts.map((o, i) => `<button class="choice" data-topic="${esc(o.topic)}"><span class="k">${L[i]}</span>${esc(o.topic)}</button>`).join('');
  app.innerHTML = `<div class="wrap">${hud()}
    <div class="qcard">
      <span class="dir">identify</span>
      <span class="catchip">${esc(CATS[c.cat])}</span>
      <div class="answer" id="bfans">${c.backMasked || c.back}</div>
      <div style="margin-top:16px;font-weight:650">Which concept is this?</div>
      <div class="choices" id="choices">${btns}</div>
    </div></div>`;
  function finish(picked: HTMLElement | null): void {
    if (ses.answered) return;
    answeredNow();
    const ok = picked ? picked.dataset.topic === c.topic : false;
    app.querySelectorAll('.choice').forEach((b) => {
      (b as HTMLButtonElement).disabled = true;
      if ((b as HTMLElement).dataset.topic === c.topic) b.classList.add('correct');
    });
    if (picked && !ok) picked.classList.add('wrong');
    const ansEl = app.querySelector('#bfans');
    if (ansEl) ansEl.innerHTML = c.back; // reveal the un-masked answer
    record(c, ok);
    if (ok) grantReward('bf');
    else breakCombo();
    const note = picked ? '' : '<div class="grade-note bad">⏱ Timed out</div>';
    const cont = document.createElement('div');
    cont.innerHTML = note + '<div class="actions center"><button class="btn primary" id="next">Next <kbd>→</kbd></button></div>';
    app.querySelector('#choices')!.after(cont);
    app.querySelector('#next')!.addEventListener('click', advance);
  }
  ses._onTimeout = () => finish(null);
  app.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', () => finish(b as HTMLElement)));
  setKey((e) => {
    if (e.target && (e.target as HTMLElement).classList && (e.target as HTMLElement).classList.contains('noteta')) return;
    if (navKey(e, !!ses.answered)) return;
    if (!ses.answered) {
      const idx = ['1', '2', '3', '4', '5', '6', '7', '8'].indexOf(e.key);
      if (idx >= 0) {
        const b = app.querySelectorAll('.choice')[idx];
        if (b) finish(b as HTMLElement);
      }
    }
  });
}

export function renderCZ(c: GameCard): void {
  const ses = S.ses!;
  ses.answered = false;
  const cz = c.cloze!;
  app.innerHTML = `<div class="wrap">${hud()}
    <div class="qcard">
      <span class="dir">fill in</span>
      <span class="catchip">${esc(CATS[c.cat])}</span>
      <div class="cloze">${esc(cz.pre)}<input id="blank" class="blank" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="?">${esc(cz.post)}</div>
      <div class="actions" id="act"><button class="btn primary" id="submit">Check &nbsp;<kbd>Enter</kbd></button></div>
    </div></div>`;
  const inp = app.querySelector('#blank') as HTMLInputElement;
  setTimeout(() => inp.focus(), 30);
  function finish(timedOut: boolean): void {
    if (ses.answered) return;
    answeredNow();
    const ok = timedOut ? false : czOK(inp.value, cz);
    inp.disabled = true;
    inp.classList.add(ok ? 'correct' : 'wrong');
    record(c, ok);
    if (ok) grantReward('cz');
    else breakCombo();
    const canDispute = !timedOut && !ok && !!inp.value.trim();
    const msg = timedOut
      ? `<span class="cz-bad">⏱ timed out · answer: <b>${esc(cz.answer)}</b></span>`
      : ok
        ? `<span class="cz-ok">✓ correct</span>`
        : `<span class="cz-bad">✗ answer: <b>${esc(cz.answer)}</b></span>`;
    app.querySelector('#act')!.outerHTML = `<div class="cz-fb" id="czfb">${msg}${canDispute ? ` <button class="btn ghost sm" id="dispute" title="honor system — count as correct">I was right</button>` : ''}</div><div class="reveal-topic">${esc(c.topic)}</div><div class="answer" style="margin-top:6px">${c.back}</div><div class="actions"><button class="btn primary" id="next">Next <kbd>→</kbd></button></div>`;
    app.querySelector('#next')!.addEventListener('click', advance);
    const dsp = app.querySelector('#dispute');
    if (dsp) dsp.addEventListener('click', () => dispute(c, inp));
  }
  ses._onTimeout = () => finish(true);
  app.querySelector('#submit')!.addEventListener('click', () => finish(false));
  setKey((e) => {
    if (e.target && (e.target as HTMLElement).classList && (e.target as HTMLElement).classList.contains('noteta')) return;
    if (navKey(e, !!ses.answered)) return;
    if (!ses.answered) {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(false);
      }
    }
  });
}

export function renderMA(c: GameCard): void {
  const ses = S.ses!;
  ses.answered = false;
  const pairs = shuffle(c.match!.map((p) => [p[0], p[1]])).slice(0, Math.min(5, c.match!.length));
  const lefts = pairs.map((p) => p[0]);
  const rightVals = shuffle(pairs.map((p) => p[1]));
  const correctRi = pairs.map((p) => rightVals.indexOf(p[1]));
  const assign: Record<number, number> = {}; // li -> ri
  const PAL = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899'];
  app.innerHTML = `<div class="wrap">${hud()}
    <div class="qcard">
      <span class="dir">match</span>
      <span class="catchip">${esc(CATS[c.cat])}</span>
      <div class="topic" style="font-size:16px">${esc(c.topic)}</div>
      <div class="ptip">Drag an arrow from a left item to its match. Drag again to change it; tap a left item to clear it.</div>
      <div class="match" id="matchbox">
        <svg class="matchsvg" id="matchsvg"></svg>
        <div class="mcol" id="mL">${lefts.map((l, li) => `<div class="mitem" data-li="${li}"><span class="mtxt">${esc(l)}</span><span class="dot r"></span></div>`).join('')}</div>
        <div class="mcol" id="mR">${rightVals.map((r, ri) => `<div class="mitem" data-ri="${ri}"><span class="dot l"></span><span class="mtxt">${esc(r)}</span></div>`).join('')}</div>
      </div>
      <div class="actions" id="act"><button class="btn primary" id="mcheck" disabled>Check</button></div>
    </div></div>`;
  const box = app.querySelector('#matchbox') as HTMLElement,
    svg = app.querySelector('#matchsvg') as SVGElement;
  const Lb = (li: number | string): HTMLElement => app.querySelector('#mL .mitem[data-li="' + li + '"]') as HTMLElement;
  const Rb = (ri: number | string): HTMLElement => app.querySelector('#mR .mitem[data-ri="' + ri + '"]') as HTMLElement;
  const DEFS = '<defs><marker id="marr" markerWidth="9" markerHeight="9" refX="6.5" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="context-stroke"/></marker></defs>';
  function dot(item: HTMLElement, side: string): { x: number; y: number } {
    const d = item.querySelector('.dot.' + side)!.getBoundingClientRect(),
      bb = box.getBoundingClientRect();
    return { x: d.left + d.width / 2 - bb.left, y: d.top + d.height / 2 - bb.top };
  }
  function path(a: { x: number; y: number }, b: { x: number; y: number }, col: string, dashed: boolean): string {
    return `<path d="M${a.x},${a.y} L${b.x},${b.y}" fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="round" ${dashed ? 'stroke-dasharray="6 5"' : ''} marker-end="url(#marr)"/>`;
  }
  function redraw(drag: { li: number; x: number; y: number } | null): void {
    let h = DEFS;
    const keys = Object.keys(assign);
    keys.forEach((li, i) => {
      h += path(dot(Lb(li), 'r'), dot(Rb(assign[+li]), 'l'), PAL[i % PAL.length], false);
    });
    if (drag) {
      h += path(dot(Lb(drag.li), 'r'), { x: drag.x, y: drag.y }, cssVar('--accent') || '#5a67f2', true);
    }
    svg.innerHTML = h;
    app.querySelectorAll('.mitem').forEach((x) => {
      x.classList.remove('paired');
      (x as HTMLElement).style.removeProperty('--pc');
    });
    keys.forEach((li, i) => {
      const col = PAL[i % PAL.length];
      [Lb(li), Rb(assign[+li])].forEach((x) => {
        if (x) {
          x.classList.add('paired');
          x.style.setProperty('--pc', col);
        }
      });
    });
    (app.querySelector('#mcheck') as HTMLButtonElement).disabled = keys.length !== pairs.length;
  }
  let drag: { li: number; sx: number; sy: number; moved: boolean } | null = null;
  const ptRel = (e: PointerEvent): { x: number; y: number } => {
    const bb = box.getBoundingClientRect();
    return { x: e.clientX - bb.left, y: e.clientY - bb.top };
  };
  function onMove(e: PointerEvent): void {
    if (!drag) return;
    const p = ptRel(e);
    if ((p.x - drag.sx) ** 2 + (p.y - drag.sy) ** 2 > 36) drag.moved = true;
    redraw({ li: drag.li, x: p.x, y: p.y });
  }
  function onUp(e: PointerEvent): void {
    if (!drag) return;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    const el = document.elementFromPoint(e.clientX, e.clientY),
      r = el && el.closest('#mR .mitem');
    if (r) {
      const ri = +(r as HTMLElement).dataset.ri!;
      Object.keys(assign).forEach((k) => {
        if (assign[+k] === ri) delete assign[+k];
      });
      assign[drag.li] = ri;
    } else if (!drag.moved) {
      delete assign[drag.li];
    }
    const lb = Lb(drag.li);
    if (lb) lb.classList.remove('drag');
    drag = null;
    redraw(null);
  }
  app.querySelectorAll('#mL .mitem').forEach((b) =>
    b.addEventListener('pointerdown', (ev) => {
      const e = ev as PointerEvent;
      if (ses.answered) return;
      e.preventDefault();
      const p = ptRel(e);
      drag = { li: +(b as HTMLElement).dataset.li!, sx: p.x, sy: p.y, moved: false };
      b.classList.add('drag');
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      redraw({ li: drag.li, x: p.x, y: p.y });
    }),
  );
  function check(timedOut: boolean): void {
    if (ses.answered) return;
    answeredNow();
    let allRight = true,
      h = DEFS;
    for (let li = 0; li < pairs.length; li++) {
      const good = assign[li] === correctRi[li];
      if (!good) allRight = false;
      const lb = Lb(li);
      if (lb) lb.classList.add(good ? 'mgood' : 'mbad');
      if (assign[li] != null) {
        const rb2 = Rb(assign[li]);
        if (rb2 && !good) rb2.classList.add('mbad');
        h += path(dot(lb, 'r'), dot(Rb(assign[li]), 'l'), good ? cssVar('--good') || '#12a150' : cssVar('--bad') || '#e11d48', false);
      }
      const rb = Rb(correctRi[li]);
      if (rb) rb.classList.add('mgood');
    }
    svg.innerHTML = h;
    box.classList.add('locked');
    record(c, allRight);
    if (allRight) grantReward('ma');
    else breakCombo();
    const note = timedOut ? '⏱ Timed out' : allRight ? '✓ all matched!' : '✗ red = your wrong link; green marks the right target';
    app.querySelector('#act')!.outerHTML = `<div class="grade-note" style="color:var(--${allRight ? 'good' : 'bad'})">${note}</div><div class="reveal-topic">${esc(c.topic)}</div><div class="answer" style="margin-top:6px">${c.back}</div><div class="actions"><button class="btn primary" id="next">Next <kbd>→</kbd></button></div>`;
    app.querySelector('#next')!.addEventListener('click', advance);
  }
  ses._onTimeout = () => check(true);
  app.querySelector('#mcheck')!.addEventListener('click', () => check(false));
  setTimeout(() => redraw(null), 40);
  setKey((e) => {
    if (e.target && (e.target as HTMLElement).classList && (e.target as HTMLElement).classList.contains('noteta')) return;
    if (navKey(e, !!ses.answered)) return;
    if (!ses.answered && e.key === 'Enter' && Object.keys(assign).length === pairs.length) {
      e.preventDefault();
      check(false);
    }
  });
}

export function renderMS(c: GameCard): void {
  const ses = S.ses!;
  ses.answered = false;
  const nCorrect = Math.min(4, c.multi!.length);
  const chosen = shuffle(c.multi!.slice()).slice(0, nCorrect);
  const others: string[] = [];
  for (const id in MULTIPOOL) {
    if (id !== c.id) others.push(...MULTIPOOL[id]);
  }
  const distract = shuffle(others.filter((n) => !c.multi!.includes(n)))
    .filter((n, i, a) => a.indexOf(n) === i)
    .slice(0, Math.max(4, 8 - nCorrect));
  const opts = shuffle(chosen.map((n) => ({ n, ok: true })).concat(distract.map((n) => ({ n, ok: false }))));
  const picked = new Set<number>();
  app.innerHTML = `<div class="wrap">${hud()}
    <div class="qcard">
      <span class="dir">select all</span>
      <span class="catchip">${esc(CATS[c.cat])}</span>
      <div class="topic" style="font-size:18px">Which of these are <b>${esc(c.topic)}</b>?</div>
      <div class="ptip">Select every correct option — a wrong pick fails the card.</div>
      <div class="choices mschoices" id="choices">${opts.map((o, i) => `<button class="choice" data-i="${i}"><span class="k">☐</span>${esc(o.n)}</button>`).join('')}</div>
      <div class="actions" id="act"><button class="btn primary" id="mscheck">Check</button></div>
    </div></div>`;
  app.querySelectorAll('.choice').forEach((b) =>
    b.addEventListener('click', () => {
      if (ses.answered) return;
      const i = +(b as HTMLElement).dataset.i!;
      if (picked.has(i)) {
        picked.delete(i);
        b.classList.remove('picked');
        b.querySelector('.k')!.textContent = '☐';
      } else {
        picked.add(i);
        b.classList.add('picked');
        b.querySelector('.k')!.textContent = '☑';
      }
    }),
  );
  function check(timedOut: boolean): void {
    if (ses.answered) return;
    answeredNow();
    let allRight = !timedOut;
    opts.forEach((o, i) => {
      const b = app.querySelector('.choice[data-i="' + i + '"]') as HTMLButtonElement;
      b.disabled = true;
      const sel = picked.has(i);
      if (o.ok && sel) b.classList.add('correct');
      else if (o.ok && !sel) {
        b.classList.add('missed-opt');
        allRight = false;
      } else if (!o.ok && sel) {
        b.classList.add('wrong');
        allRight = false;
      }
    });
    record(c, allRight);
    if (allRight) grantReward('ms');
    else breakCombo();
    const note = timedOut ? '⏱ Timed out' : allRight ? '✓ perfect selection!' : '✗ the correct set is highlighted';
    app.querySelector('#act')!.outerHTML = `<div class="grade-note" style="color:var(--${allRight ? 'good' : 'bad'})">${note}</div><div class="actions"><button class="btn primary" id="next">Next <kbd>→</kbd></button></div>`;
    app.querySelector('#next')!.addEventListener('click', advance);
  }
  ses._onTimeout = () => check(true);
  app.querySelector('#mscheck')!.addEventListener('click', () => check(false));
  setKey((e) => {
    if (e.target && (e.target as HTMLElement).classList && (e.target as HTMLElement).classList.contains('noteta')) return;
    if (navKey(e, !!ses.answered)) return;
    if (!ses.answered) {
      const idx = ['1', '2', '3', '4', '5', '6', '7', '8'].indexOf(e.key);
      if (idx >= 0) {
        const b = app.querySelectorAll('.choice')[idx];
        if (b) (b as HTMLElement).click();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        check(false);
      }
    }
  });
}

// Inverse recall: show the (topic-masked) definition, recall the concept name. Honor-graded.
export function renderIV(c: GameCard): void {
  const ses = S.ses!;
  ses.answered = false;
  app.innerHTML = `<div class="wrap">${hud()}
    <div class="qcard">
      <span class="dir">name it</span>
      <span class="catchip">${esc(CATS[c.cat])}</span>
      <div class="ptip">From the description, recall the CONCEPT (the card's title).</div>
      <div class="answer" id="ivdef">${c.backMasked || c.back}</div>
      <div class="cloze" style="margin-top:14px">Concept: <input id="blank" class="blank" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="the term…" style="min-width:220px"></div>
      <div class="actions" id="act"><button class="btn primary" id="submit">Check &nbsp;<kbd>Enter</kbd></button></div>
    </div></div>`;
  const inp = app.querySelector('#blank') as HTMLInputElement;
  setTimeout(() => inp.focus(), 30);
  function ivOK(v: string): boolean {
    v = norm(v);
    if (!v) return false;
    const t = norm(c.topic);
    if (v === t) return true;
    const tw = t.split(' ').filter((w) => w.length > 3);
    if (!tw.length) return false;
    const gw = new Set(v.split(' '));
    const hit = tw.filter((w) => gw.has(w)).length;
    return hit >= Math.ceil(tw.length * 0.6);
  }
  function finish(timedOut: boolean): void {
    if (ses.answered) return;
    answeredNow();
    const ok = timedOut ? false : ivOK(inp.value);
    inp.disabled = true;
    inp.classList.add(ok ? 'correct' : 'wrong');
    const ansEl = app.querySelector('#ivdef');
    if (ansEl) ansEl.innerHTML = c.back;
    record(c, ok);
    if (!ok) breakCombo();
    const canDispute = !timedOut && !ok && !!inp.value.trim();
    const msg = timedOut
      ? `<span class="cz-bad">⏱ timed out · it was: <b>${esc(c.topic)}</b></span>`
      : ok
        ? `<span class="cz-ok">✓ ${esc(c.topic)}</span>`
        : `<span class="cz-bad">✗ it was: <b>${esc(c.topic)}</b></span>`;
    app.querySelector('#act')!.outerHTML = `<div class="cz-fb" id="czfb">${msg}${canDispute ? ` <button class="btn ghost sm" id="dispute" title="honor system — count as correct">I was right</button>` : ''}</div><div class="actions"><button class="btn primary" id="next">Next <kbd>→</kbd></button></div>`;
    app.querySelector('#next')!.addEventListener('click', advance);
    const dsp = app.querySelector('#dispute');
    if (dsp) dsp.addEventListener('click', () => dispute(c, inp));
  }
  ses._onTimeout = () => finish(true);
  app.querySelector('#submit')!.addEventListener('click', () => finish(false));
  setKey((e) => {
    if (e.target && (e.target as HTMLElement).classList && (e.target as HTMLElement).classList.contains('noteta')) return;
    if (navKey(e, !!ses.answered)) return;
    if (!ses.answered && e.key === 'Enter') {
      e.preventDefault();
      finish(false);
    }
  });
}

// Drag labels onto the blanks in a YAML/code block (or tap a label then a blank).
export function renderDM(c: GameCard): void {
  const ses = S.ses!;
  ses.answered = false;
  const M = c.manifest!;
  const chips = shuffle(M.blanks.concat(M.distractors || []).map((t) => ({ t })));
  let sel: HTMLElement | null = null;
  const codeHtml = M.lines.map((line) => esc(line).replace(/\{(\d+)\}/g, (_m, si) => `<span class="dslot" data-si="${si}" tabindex="0"></span>`)).join('\n');
  const chipHtml = chips.map((o, i) => `<span class="dchip" draggable="true" data-ci="${i}">${esc(o.t)}</span>`).join('');
  app.innerHTML = `<div class="wrap">${hud()}
    <div class="qcard">
      <span class="dir">label the YAML</span>
      <span class="catchip">${esc(CATS[c.cat])}</span>
      <div class="topic" style="font-size:16px">${esc(c.topic)}</div>
      <div class="ptip">Drag each label into the right blank — or tap a label, then tap a blank. Fill every blank.</div>
      <pre class="dmcode">${codeHtml}</pre>
      <div class="dmtray" id="dmtray">${chipHtml}</div>
      <div class="actions" id="act"><button class="btn primary" id="dmcheck" disabled>Check</button></div>
    </div></div>`;
  const tray = app.querySelector('#dmtray') as HTMLElement;
  function refresh(): void {
    let all = true;
    app.querySelectorAll('.dslot').forEach((s) => {
      if (!(s as HTMLElement).dataset.ci) all = false;
    });
    const b = app.querySelector('#dmcheck') as HTMLButtonElement | null;
    if (b) b.disabled = !all;
  }
  function placeChip(ci: number, slot: HTMLElement): void {
    app.querySelectorAll('.dslot').forEach((s) => {
      if ((s as HTMLElement).dataset.ci === String(ci)) {
        s.textContent = '';
        delete (s as HTMLElement).dataset.ci;
        s.classList.remove('filled');
      }
    });
    if (slot.dataset.ci) {
      const prev = tray.querySelector('.dchip[data-ci="' + slot.dataset.ci + '"]');
      if (prev) prev.classList.remove('used');
    }
    slot.dataset.ci = String(ci);
    slot.textContent = chips[ci].t;
    slot.classList.add('filled');
    const chipEl = tray.querySelector('.dchip[data-ci="' + ci + '"]');
    if (chipEl) chipEl.classList.add('used');
    refresh();
  }
  tray.querySelectorAll('.dchip').forEach((ch) => {
    ch.addEventListener('dragstart', (ev) => {
      const e = ev as DragEvent;
      if (ses.answered) {
        e.preventDefault();
        return;
      }
      e.dataTransfer!.setData('text/plain', (ch as HTMLElement).dataset.ci!);
    });
    ch.addEventListener('click', () => {
      if (ses.answered || ch.classList.contains('used')) return;
      if (sel === ch) {
        sel = null;
        ch.classList.remove('sel');
      } else {
        if (sel) sel.classList.remove('sel');
        sel = ch as HTMLElement;
        ch.classList.add('sel');
      }
    });
  });
  app.querySelectorAll('.dslot').forEach((slotEl) => {
    const slot = slotEl as HTMLElement;
    slot.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    slot.addEventListener('drop', (ev) => {
      const e = ev as DragEvent;
      e.preventDefault();
      if (ses.answered) return;
      const ci = e.dataTransfer!.getData('text/plain');
      if (ci !== '') placeChip(+ci, slot);
    });
    slot.addEventListener('click', () => {
      if (ses.answered) return;
      if (sel) {
        placeChip(+sel.dataset.ci!, slot);
        sel.classList.remove('sel');
        sel = null;
      } else if (slot.dataset.ci) {
        const chip = tray.querySelector('.dchip[data-ci="' + slot.dataset.ci + '"]');
        if (chip) chip.classList.remove('used');
        slot.textContent = '';
        delete slot.dataset.ci;
        slot.classList.remove('filled');
        refresh();
      }
    });
  });
  function check(timedOut: boolean): void {
    if (ses.answered) return;
    answeredNow();
    let allRight = !timedOut;
    app.querySelectorAll('.dslot').forEach((slotEl) => {
      const slot = slotEl as HTMLElement;
      const si = +slot.dataset.si!,
        ci = slot.dataset.ci;
      const got = ci != null && ci !== '' ? chips[+ci].t : null;
      const want = M.blanks[si];
      if (got === want) {
        slot.classList.add('dgood');
      } else {
        slot.classList.add('dbad');
        allRight = false;
        slot.textContent = want;
      }
      slot.classList.add('filled');
    });
    record(c, allRight);
    if (allRight) grantReward('ma');
    else breakCombo();
    const note = timedOut ? '⏱ Timed out' : allRight ? '✓ all labels correct!' : '✗ red = wrong; the correct label is now shown';
    app.querySelector('#act')!.outerHTML = `<div class="grade-note" style="color:var(--${allRight ? 'good' : 'bad'})">${note}</div><div class="reveal-topic">${esc(c.topic)}</div><div class="answer" style="margin-top:6px">${c.back}</div><div class="actions"><button class="btn primary" id="next">Next <kbd>→</kbd></button></div>`;
    app.querySelector('#next')!.addEventListener('click', advance);
  }
  ses._onTimeout = () => check(true);
  app.querySelector('#dmcheck')!.addEventListener('click', () => check(false));
  setKey((e) => {
    if (e.target && (e.target as HTMLElement).classList && (e.target as HTMLElement).classList.contains('noteta')) return;
    if (navKey(e, !!ses.answered)) return;
    if (!ses.answered && e.key === 'Enter') {
      const b = app.querySelector('#dmcheck') as HTMLButtonElement | null;
      if (b && !b.disabled) {
        e.preventDefault();
        check(false);
      }
    }
  });
}

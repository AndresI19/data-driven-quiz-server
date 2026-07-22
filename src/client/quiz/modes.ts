import type { GameCard } from '../../shared/card-schema.js';
// The nine quiz modes: identify (BF), fill-in (CZ), match (MA), multi-select (MS), inverse (IV),
// label-the-YAML (DM), order (OR), read-the-code (CW), and select-lines (CS). Open-ended recall was
// removed — it awarded no points and could not be machine-graded.
//
// Each mode owns exactly one thing: how its question is asked and how the answer is read back. The
// frame around that — the card shell, the scoring, the ending, the key guards — lives in card.ts, so
// what is left below is the part that genuinely differs between modes.
import { ACCENT_FALLBACK, MULTIPOOL, app } from '../runtime/data.js';
import type { Session } from '../runtime/state.js';
import { cssVarOr, esc, shuffle } from '../runtime/util.js';
import { choiceIndex, drawCard, endCard, endGraded, modeKeys, score, typedFeedback } from './card.js';
import { codeSelectOK, czOK, distractors, ivOK, orderOK } from './grading.js';
import { advance } from './session.js';
import { answeredNow } from './timer.js';

/** Delay before focusing a freshly-rendered input, letting innerHTML settle first. */
const FOCUS_DELAY = 30;

/** Focus a freshly-rendered field once its innerHTML has settled. */
function focusSoon(el: HTMLElement): void {
  setTimeout(() => el.focus(), FOCUS_DELAY);
}

/** The A–H hotkey letters shared by every single-pick choice grid. */
const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/**
 * Shared scaffold for the single-pick "choice grid" modes (identify / read-the-code). The pool is
 * deduped against the answer, capped at seven, and the correct card is mixed in; picking one (or
 * timing out) disables the grid, marks correct/wrong, scores, and appends a Next button.
 *
 * The two callers differ only in: the pre-shuffle distractor order, the direction label, the
 * question HTML above the grid, the score key, and an optional reveal step run just before scoring.
 */
function renderChoice(
  c: GameCard,
  dir: string,
  poolSource: { topic: string }[],
  question: (btns: string) => string,
  scoreKey: string,
  reveal?: () => void,
): void {
  const seen = new Set([c.topic]);
  const pool = shuffle(poolSource)
    .filter((o) => {
      if (seen.has(o.topic)) return false;
      seen.add(o.topic);
      return true;
    })
    .slice(0, 7);
  const opts = shuffle(pool.concat(c));
  const btns = opts
    .map(
      (o, i) =>
        `<button class="choice" data-topic="${esc(o.topic)}"><span class="k">${CHOICE_LETTERS[i]}</span>${esc(o.topic)}</button>`,
    )
    .join('');

  const ses = drawCard(c, dir, question(btns));

  function finish(picked: HTMLElement | null): void {
    if (ses.answered) return;
    answeredNow();
    const ok = picked ? picked.dataset.topic === c.topic : false;
    app.querySelectorAll('.choice').forEach((b) => {
      (b as HTMLButtonElement).disabled = true;
      if ((b as HTMLElement).dataset.topic === c.topic) b.classList.add('correct');
    });
    if (picked && !ok) picked.classList.add('wrong');
    if (reveal) reveal();
    score(c, ok, scoreKey);

    // This mode has no #act to replace — its Next button is appended after the choices — so it does
    // its own ending rather than calling endCard.
    const note = picked ? '' : '<div class="grade-note bad">⏱ Timed out</div>';
    const cont = document.createElement('div');
    cont.innerHTML = `${note}<div class="actions center"><button class="btn primary" id="next">Next <kbd>→</kbd></button></div>`;
    app.querySelector('#choices')!.after(cont);
    app.querySelector('#next')!.addEventListener('click', advance);
  }

  ses._onTimeout = () => finish(null);
  app.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', () => finish(b as HTMLElement)));

  modeKeys((e) => {
    if (ses.answered) return;
    const idx = choiceIndex(e);
    if (idx >= 0) {
      const b = app.querySelectorAll('.choice')[idx];
      if (b) finish(b as HTMLElement);
    }
  });
}

/** Identify: show the (masked) answer, pick the concept it describes. */
export function renderBF(c: GameCard): void {
  const extras = (c.mc || []).map((s) => ({ topic: s }));
  renderChoice(
    c,
    'identify',
    (distractors(c, 7) as { topic: string }[]).concat(extras),
    (btns) => `<div class="answer" id="bfans">${c.backMasked || c.back}</div>
      <div style="margin-top:16px;font-weight:650">Which concept is this?</div>
      <div class="choices" id="choices">${btns}</div>`,
    'bf',
    () => {
      const ansEl = app.querySelector('#bfans');
      if (ansEl) ansEl.innerHTML = c.back; // reveal the un-masked answer
    },
  );
}

/** Fill-in: type the missing word into the sentence. */
export function renderCZ(c: GameCard): void {
  const cz = c.cloze!;
  const ses = drawCard(
    c,
    'fill in',
    `<div class="cloze">${esc(cz.pre)}<input id="blank" class="blank" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="?">${esc(cz.post)}</div>
      <div class="actions" id="act"><button class="btn primary" id="submit">Check &nbsp;<kbd>Enter</kbd></button></div>`,
  );
  const inp = app.querySelector('#blank') as HTMLInputElement;
  focusSoon(inp);

  function finish(timedOut: boolean): void {
    if (ses.answered) return;
    answeredNow();
    const ok = !timedOut && czOK(inp.value, cz);
    inp.disabled = true;
    inp.classList.add(ok ? 'correct' : 'wrong');
    score(c, ok, 'cz');

    const msg = timedOut
      ? `<span class="cz-bad">⏱ timed out · answer: <b>${esc(cz.answer)}</b></span>`
      : ok
        ? `<span class="cz-ok">✓ correct</span>`
        : `<span class="cz-bad">✗ answer: <b>${esc(cz.answer)}</b></span>`;
    // A dispute is only offered when the player actually typed something and it was marked wrong —
    // there is nothing to honour-override about a blank or a timeout.
    const canDispute = !timedOut && !ok && !!inp.value.trim();

    endCard(c, typedFeedback(msg, canDispute), { reveal: true, disputeInput: inp });
  }

  ses._onTimeout = () => finish(true);
  app.querySelector('#submit')!.addEventListener('click', () => finish(false));

  modeKeys((e) => {
    if (!ses.answered && e.key === 'Enter') {
      e.preventDefault();
      finish(false);
    }
  });
}

/** Match: drag an arrow from each left item to its pair on the right. */
export function renderMA(c: GameCard): void {
  const pairs = shuffle(c.match!.map((p) => [p[0], p[1]])).slice(0, Math.min(5, c.match!.length));
  const lefts = pairs.map((p) => p[0]);
  const rightVals = shuffle(pairs.map((p) => p[1]));
  const correctRi = pairs.map((p) => rightVals.indexOf(p[1]));
  const assign: Record<number, number> = {}; // li -> ri
  const PAL = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899'];

  const ses = drawCard(
    c,
    'match',
    `<div class="topic" style="font-size:16px">${esc(c.topic)}</div>
      <div class="ptip">Drag an arrow from a left item to its match. Drag again to change it; tap a left item to clear it.</div>
      <div class="match" id="matchbox">
        <svg class="matchsvg" id="matchsvg"></svg>
        <div class="mcol" id="mL">${lefts.map((l, li) => `<div class="mitem" data-li="${li}"><span class="mtxt">${esc(l)}</span><span class="dot r"></span></div>`).join('')}</div>
        <div class="mcol" id="mR">${rightVals.map((r, ri) => `<div class="mitem" data-ri="${ri}"><span class="dot l"></span><span class="mtxt">${esc(r)}</span></div>`).join('')}</div>
      </div>
      <div class="actions" id="act"><button class="btn primary" id="mcheck" disabled>Check</button></div>`,
  );

  const box = app.querySelector('#matchbox') as HTMLElement;
  const svg = app.querySelector('#matchsvg') as SVGElement;
  const Lb = (li: number | string): HTMLElement =>
    app.querySelector(`#mL .mitem[data-li="${li}"]`) as HTMLElement;
  const Rb = (ri: number | string): HTMLElement =>
    app.querySelector(`#mR .mitem[data-ri="${ri}"]`) as HTMLElement;
  const DEFS =
    '<defs><marker id="marr" markerWidth="9" markerHeight="9" refX="6.5" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="context-stroke"/></marker></defs>';

  function dot(item: HTMLElement, side: string): { x: number; y: number } {
    const d = item.querySelector(`.dot.${side}`)!.getBoundingClientRect();
    const bb = box.getBoundingClientRect();
    return { x: d.left + d.width / 2 - bb.left, y: d.top + d.height / 2 - bb.top };
  }
  function path(
    a: { x: number; y: number },
    b: { x: number; y: number },
    col: string,
    dashed: boolean,
  ): string {
    return `<path d="M${a.x},${a.y} L${b.x},${b.y}" fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="round" ${dashed ? 'stroke-dasharray="6 5"' : ''} marker-end="url(#marr)"/>`;
  }
  function redraw(drag: { li: number; x: number; y: number } | null): void {
    let h = DEFS;
    const keys = Object.keys(assign);
    keys.forEach((li, i) => {
      h += path(dot(Lb(li), 'r'), dot(Rb(assign[+li]), 'l'), PAL[i % PAL.length], false);
    });
    if (drag) {
      h += path(dot(Lb(drag.li), 'r'), { x: drag.x, y: drag.y }, cssVarOr('--accent', ACCENT_FALLBACK), true);
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
    // Guarded: redraw() is also called from a 40ms setTimeout, which can fire after the view has
    // been torn down or navigated away — at which point #mcheck is gone. Setting .disabled on null
    // throws; skipping it when the button is absent is correct (there is nothing to toggle).
    const mcheck = app.querySelector('#mcheck') as HTMLButtonElement | null;
    if (mcheck) mcheck.disabled = keys.length !== pairs.length;
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
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const r = el?.closest('#mR .mitem');
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
    let allRight = true;
    let h = DEFS;
    for (let li = 0; li < pairs.length; li++) {
      const good = assign[li] === correctRi[li];
      if (!good) allRight = false;
      const lb = Lb(li);
      if (lb) lb.classList.add(good ? 'mgood' : 'mbad');
      if (assign[li] != null) {
        const rb2 = Rb(assign[li]);
        if (rb2 && !good) rb2.classList.add('mbad');
        h += path(
          dot(lb, 'r'),
          dot(Rb(assign[li]), 'l'),
          good ? cssVarOr('--good', '#12a150') : cssVarOr('--bad', '#e11d48'),
          false,
        );
      }
      const rb = Rb(correctRi[li]);
      if (rb) rb.classList.add('mgood');
    }
    svg.innerHTML = h;
    box.classList.add('locked');
    score(c, allRight, 'ma');

    endGraded(
      c,
      allRight,
      timedOut,
      '✓ all matched!',
      '✗ red = your wrong link; green marks the right target',
      { reveal: true },
    );
  }

  ses._onTimeout = () => check(true);
  app.querySelector('#mcheck')!.addEventListener('click', () => check(false));
  setTimeout(() => redraw(null), 40);

  modeKeys((e) => {
    if (!ses.answered && e.key === 'Enter' && Object.keys(assign).length === pairs.length) {
      e.preventDefault();
      check(false);
    }
  });
}

/**
 * Wire the ☐/☑ toggle onto every checkbox-style option (`.choice` or `.cl-btn`). Clicking a live
 * option flips its membership in `picked` and swaps the box glyph; a graded card ignores clicks.
 */
function bindCheckboxToggle(selector: string, ses: Session, picked: Set<number>): void {
  app.querySelectorAll(selector).forEach((b) =>
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
}

/**
 * The shared reveal loop for the two multi-pick modes: disable every option and paint it correct /
 * missed-opt / wrong from `picked` and a per-mode correctness predicate. Options are addressed by
 * `${selector}[data-i="i"]` for i in 0..count-1.
 */
function gradeCheckboxes(
  selector: string,
  count: number,
  picked: Set<number>,
  isCorrect: (i: number) => boolean,
): void {
  for (let i = 0; i < count; i++) {
    const b = app.querySelector(`${selector}[data-i="${i}"]`) as HTMLButtonElement;
    b.disabled = true;
    const sel = picked.has(i);
    const correct = isCorrect(i);
    if (correct && sel) b.classList.add('correct');
    else if (correct && !sel) b.classList.add('missed-opt');
    else if (!correct && sel) b.classList.add('wrong');
  }
}

/**
 * The key handler shared by the two multi-pick modes: a number key toggles the option it addresses
 * (by clicking it, so the toggle logic stays in one place), and Enter submits. `selector` is the
 * option class — `.choice` for multi-select, `.cl-btn` for select-lines.
 */
function checkboxKeys(selector: string, ses: Session, check: (timedOut: boolean) => void): void {
  modeKeys((e) => {
    if (ses.answered) return;
    const idx = choiceIndex(e);
    if (idx >= 0) {
      const b = app.querySelectorAll(selector)[idx];
      if (b) (b as HTMLElement).click();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      check(false);
    }
  });
}

/** Multi-select: tick every member of a set. One wrong pick fails the card. */
export function renderMS(c: GameCard): void {
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

  const ses = drawCard(
    c,
    'select all',
    `<div class="topic" style="font-size:18px">Which of these are <b>${esc(c.topic)}</b>?</div>
      <div class="ptip">Select every correct option — a wrong pick fails the card.</div>
      <div class="choices mschoices" id="choices">${opts.map((o, i) => `<button class="choice" data-i="${i}"><span class="k">☐</span>${esc(o.n)}</button>`).join('')}</div>
      <div class="actions" id="act"><button class="btn primary" id="mscheck">Check</button></div>`,
  );

  bindCheckboxToggle('.choice', ses, picked);

  function check(timedOut: boolean): void {
    if (ses.answered) return;
    answeredNow();
    const allRight = !timedOut && opts.every((o, i) => o.ok === picked.has(i));
    gradeCheckboxes('.choice', opts.length, picked, (i) => opts[i].ok);
    score(c, allRight, 'ms');

    endGraded(c, allRight, timedOut, '✓ perfect selection!', '✗ the correct set is highlighted');
  }

  ses._onTimeout = () => check(true);
  app.querySelector('#mscheck')!.addEventListener('click', () => check(false));

  checkboxKeys('.choice', ses, check);
}

/** Inverse recall: show the (topic-masked) definition, name the concept. Machine-graded by ivOK. */
export function renderIV(c: GameCard): void {
  const ses = drawCard(
    c,
    'name it',
    `<div class="ptip">From the description, recall the CONCEPT (the card's title).</div>
      <div class="answer" id="ivdef">${c.backMasked || c.back}</div>
      <div class="cloze" style="margin-top:14px">Concept: <input id="blank" class="blank" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="the term…" style="min-width:220px"></div>
      <div class="actions" id="act"><button class="btn primary" id="submit">Check &nbsp;<kbd>Enter</kbd></button></div>`,
  );
  const inp = app.querySelector('#blank') as HTMLInputElement;
  focusSoon(inp);

  function finish(timedOut: boolean): void {
    if (ses.answered) return;
    answeredNow();
    const ok = !timedOut && ivOK(inp.value, c.topic);
    inp.disabled = true;
    inp.classList.add(ok ? 'correct' : 'wrong');
    const ansEl = app.querySelector('#ivdef');
    if (ansEl) ansEl.innerHTML = c.back;
    score(c, ok, 'iv');

    const msg = timedOut
      ? `<span class="cz-bad">⏱ timed out · it was: <b>${esc(c.topic)}</b></span>`
      : ok
        ? `<span class="cz-ok">✓ ${esc(c.topic)}</span>`
        : `<span class="cz-bad">✗ it was: <b>${esc(c.topic)}</b></span>`;
    const canDispute = !timedOut && !ok && !!inp.value.trim();

    // No reveal: the answer is the topic, and it is already in the feedback line above.
    endCard(c, typedFeedback(msg, canDispute), { disputeInput: inp });
  }

  ses._onTimeout = () => finish(true);
  app.querySelector('#submit')!.addEventListener('click', () => finish(false));

  modeKeys((e) => {
    if (!ses.answered && e.key === 'Enter') {
      e.preventDefault();
      finish(false);
    }
  });
}

/**
 * Fill: drag each label into its blank in a passage — prose by default, or a monospace code block
 * when `fill.code` is set. The generalized form of the old "label the YAML": a YAML card is just a
 * fill card with `code: true`, so prose concepts and config share one interaction and one renderer.
 */
export function renderFill(c: GameCard): void {
  const F = c.fill!;
  const chips = shuffle(F.blanks.concat(F.distractors || []).map((t) => ({ t })));
  let sel: HTMLElement | null = null;
  // esc() leaves the {N} placeholders untouched (they contain no HTML-special chars), so we can swap
  // them for drop-slots afterwards. Newlines survive too, so a code passage renders inside <pre>.
  const withSlots = (s: string): string =>
    esc(s).replace(/\{(\d+)\}/g, (_m, si) => `<span class="dslot" data-si="${si}" tabindex="0"></span>`);
  const passage = F.code
    ? `<pre class="dmcode">${withSlots(F.text)}</pre>`
    : `<div class="filltext">${withSlots(F.text)}</div>`;
  const chipHtml = chips
    .map((o, i) => `<span class="dchip" draggable="true" data-ci="${i}">${esc(o.t)}</span>`)
    .join('');

  const ses = drawCard(
    c,
    F.code ? 'label the config' : 'fill the terms',
    `<div class="topic" style="font-size:16px">${esc(c.topic)}</div>
      <div class="ptip">Drag each label into the right blank — or tap a label, then tap a blank. Fill every blank.</div>
      ${passage}
      <div class="dmtray" id="dmtray">${chipHtml}</div>
      <div class="actions" id="act"><button class="btn primary" id="dmcheck" disabled>Check</button></div>`,
  );

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
      const prev = tray.querySelector(`.dchip[data-ci="${slot.dataset.ci}"]`);
      if (prev) prev.classList.remove('used');
    }
    slot.dataset.ci = String(ci);
    slot.textContent = chips[ci].t;
    slot.classList.add('filled');
    const chipEl = tray.querySelector(`.dchip[data-ci="${ci}"]`);
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
        const chip = tray.querySelector(`.dchip[data-ci="${slot.dataset.ci}"]`);
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
      const si = +slot.dataset.si!;
      const ci = slot.dataset.ci;
      const got = ci != null && ci !== '' ? chips[+ci].t : null;
      const want = F.blanks[si];
      if (got === want) {
        slot.classList.add('dgood');
      } else {
        slot.classList.add('dbad');
        allRight = false;
        slot.textContent = want;
      }
      slot.classList.add('filled');
    });
    score(c, allRight, 'fl');

    endGraded(
      c,
      allRight,
      timedOut,
      '✓ all labels correct!',
      '✗ red = wrong; the correct label is now shown',
      { reveal: true },
    );
  }

  ses._onTimeout = () => check(true);
  app.querySelector('#dmcheck')!.addEventListener('click', () => check(false));

  modeKeys((e) => {
    if (!ses.answered && e.key === 'Enter') {
      const b = app.querySelector('#dmcheck') as HTMLButtonElement | null;
      if (b && !b.disabled) {
        e.preventDefault();
        check(false);
      }
    }
  });
}

/** A code block as static HTML (for "read the code" mode and answer reveals). */
function codeBlock(code: NonNullable<GameCard['code']>): string {
  const rows = code.lines.map((ln) => `<div class="cl">${esc(ln) || '&nbsp;'}</div>`).join('');
  const lang = code.lang ? ` data-lang="${esc(code.lang)}"` : '';
  return `<pre class="codeblock"${lang}>${rows}</pre>`;
}

/** Read the code: show a block, pick what it does. Correct = the topic; distractors = authored mc. */
export function renderCW(c: GameCard): void {
  const code = c.code!;
  const extras = (c.mc || []).map((s) => ({ topic: s }));
  renderChoice(
    c,
    'read the code',
    // Prefer the card's own authored distractors; top up from the global pool only if it runs short.
    extras.concat(distractors(c, 7) as { topic: string }[]),
    (btns) => `${codeBlock(code)}
      <div style="margin-top:16px;font-weight:650">What is this code doing?</div>
      <div class="choices" id="choices">${btns}</div>`,
    'cw',
  );
}

/** Select the lines: tick every line that does X. One wrong (or missing) line fails the card. */
export function renderCS(c: GameCard): void {
  const code = c.code!;
  const cs = c.codeselect!;
  const answer = new Set(cs.answer);
  const picked = new Set<number>();
  const rows = code.lines
    .map(
      (ln, i) =>
        `<button class="cl-btn" data-i="${i}"><span class="k">☐</span><span class="cl-code">${esc(ln) || '&nbsp;'}</span></button>`,
    )
    .join('');

  const ses = drawCard(
    c,
    'select lines',
    `<div class="topic" style="font-size:17px">${esc(cs.prompt)}</div>
      <div class="ptip">Tick every line that applies — a wrong or missing line fails the card.</div>
      <div class="codeselect" id="choices"${code.lang ? ` data-lang="${esc(code.lang)}"` : ''}>${rows}</div>
      <div class="actions" id="act"><button class="btn primary" id="mscheck">Check</button></div>`,
  );

  bindCheckboxToggle('.cl-btn', ses, picked);

  function check(timedOut: boolean): void {
    if (ses.answered) return;
    answeredNow();
    const allRight = !timedOut && codeSelectOK([...picked], cs.answer);
    gradeCheckboxes('.cl-btn', code.lines.length, picked, (i) => answer.has(i));
    score(c, allRight, 'cs');

    endGraded(c, allRight, timedOut, '✓ exactly the right lines!', '✗ the correct lines are highlighted');
  }

  ses._onTimeout = () => check(true);
  app.querySelector('#mscheck')!.addEventListener('click', () => check(false));

  checkboxKeys('.cl-btn', ses, check);
}

/** Order: drag the shuffled steps into the correct sequence, then check. */
export function renderOR(c: GameCard): void {
  const answer = c.order!;
  const n = answer.length;
  // Work with stable ids 0..n-1 (id i ⇒ answer[i]); `cur` is the displayed order of those ids, so a
  // move re-splices ids and grading is a text compare that stays correct even if steps repeat.
  // Reshuffle a few times if the shuffle lands already-solved — likely for small n, and a pre-solved
  // card is no question at all.
  let cur = shuffle(answer.map((_, i) => i));
  for (let t = 0; t < 8 && cur.every((id, p) => answer[id] === answer[p]); t++) {
    cur = shuffle(answer.map((_, i) => i));
  }

  const ses = drawCard(
    c,
    'order',
    `<div class="topic" style="font-size:16px">${esc(c.topic)}</div>
      <div class="ptip">Drag the steps into the correct order, then Check.</div>
      <div class="orderlist" id="orderlist"></div>
      <div class="actions" id="act"><button class="btn primary" id="ocheck">Check &nbsp;<kbd>Enter</kbd></button></div>`,
  );

  // The id currently being dragged (stable across re-renders), or null when nothing is in hand.
  let dragId: number | null = null;

  function draw(): void {
    const list = app.querySelector('#orderlist');
    if (!list) return;
    list.innerHTML = cur
      .map(
        (id, p) =>
          `<div class="oitem${id === dragId ? ' dragging' : ''}" data-p="${p}"><span class="ohandle" aria-hidden="true">⠿</span><span class="onum">${p + 1}</span><span class="otxt">${esc(answer[id])}</span></div>`,
      )
      .join('');
    if (ses.answered) return; // a graded card is inert — no drag handlers
    list
      .querySelectorAll('.oitem')
      .forEach((el) =>
        el.addEventListener('pointerdown', (ev) =>
          startDrag(ev as PointerEvent, +(el as HTMLElement).dataset.p!),
        ),
      );
  }

  // Move the dragged id to `target`, re-splicing rather than swapping so the list slides like a real
  // sortable — the items between origin and target shift by one, not just the two endpoints.
  function moveTo(target: number): void {
    if (dragId === null || target < 0 || target >= n) return;
    const from = cur.indexOf(dragId);
    if (target === from) return;
    cur.splice(from, 1);
    cur.splice(target, 0, dragId);
    draw();
  }
  function onMove(e: PointerEvent): void {
    if (dragId === null) return;
    e.preventDefault();
    const row = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('.oitem');
    if (row) moveTo(+(row as HTMLElement).dataset.p!);
  }
  function endDrag(): void {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', endDrag);
    dragId = null;
    draw();
  }
  function startDrag(e: PointerEvent, p: number): void {
    if (ses.answered) return;
    e.preventDefault();
    dragId = cur[p];
    draw();
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', endDrag);
  }

  draw();

  function check(timedOut: boolean): void {
    if (ses.answered) return;
    if (dragId !== null) endDrag(); // settle any in-flight drag before grading
    answeredNow();
    const current = cur.map((id) => answer[id]);
    const allRight = !timedOut && orderOK(current, answer);
    draw(); // re-render inert, then tint each row green/red by whether it sits in its correct place
    app.querySelectorAll('.oitem').forEach((el) => {
      const p = +(el as HTMLElement).dataset.p!;
      el.classList.add(answer[cur[p]] === answer[p] ? 'ogood' : 'obad');
    });
    score(c, allRight, 'or');

    endGraded(
      c,
      allRight,
      timedOut,
      '✓ correct order!',
      '✗ green rows were placed right — the full order is below',
      { reveal: true },
    );
  }

  ses._onTimeout = () => check(true);
  app.querySelector('#ocheck')!.addEventListener('click', () => check(false));

  modeKeys((e) => {
    if (!ses.answered && e.key === 'Enter') {
      e.preventDefault();
      check(false);
    }
  });
}

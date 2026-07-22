import { setScreenBg } from '../garden/screenbg.js';
import { leavePlay } from '../quiz/pause.js';
import { scopedCards } from '../quiz/session.js';
// Study mode: a read-only browse of every card's full content (topic + fully-expanded answer),
// grouped by section and honouring the section scope chosen on the home screen. No scoring — this is
// the "just let me read it" path that replaced open-ended recall. It shows `printBack`, the answer
// body that is never folded, so extras/diagrams/steps are all expanded.
import { CATS, app, catAccent } from '../runtime/data.js';
import { S } from '../runtime/state.js';
import { esc, setKey } from '../runtime/util.js';
import { setup } from './home.js';

/** Cards come section-ordered from the payload, so a single pass groups them without a sort. */
function bySection<T extends { cat: string }>(cards: T[]): { cat: string; cards: T[] }[] {
  const groups: { cat: string; cards: T[] }[] = [];
  for (const c of cards) {
    const last = groups[groups.length - 1];
    if (last && last.cat === c.cat) last.cards.push(c);
    else groups.push({ cat: c.cat, cards: [c] });
  }
  return groups;
}

export function studyPage(): void {
  leavePlay();
  setScreenBg(false);
  const cards = scopedCards(S.cfg.scope);
  const body = bySection(cards)
    .map(
      (g) => `
      <div class="study-sec">
        <div class="study-sech" style="--cat:${catAccent(g.cards[0])}">${esc(CATS[g.cat] || g.cat)} <span class="tiny">· ${g.cards.length}</span></div>
        ${g.cards
          .map(
            (c) => `<div class="study-card" style="--cat:${catAccent(c)}">
              <div class="study-topic">${esc(c.topic)} <span class="tiny study-id">${c.id}</span></div>
              <div class="answer">${c.printBack}</div>
            </div>`,
          )
          .join('')}
      </div>`,
    )
    .join('');
  app.innerHTML = `<div class="wrap">
    <div class="rvbar">
      <button class="btn ghost sm" id="studyback">← Home</button>
      <div class="lab" style="margin:0">📖 Study · ${cards.length} card${cards.length === 1 ? '' : 's'}</div>
      <span></span>
    </div>
    ${
      cards.length
        ? body
        : '<div class="panel"><div class="tiny">No cards in this selection — pick sections on the home screen first.</div></div>'
    }
  </div>`;
  app.querySelector('#studyback')!.addEventListener('click', setup);
  setKey((e) => {
    if (e.key === 'Escape') setup();
  });
}

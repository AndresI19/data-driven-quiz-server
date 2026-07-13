import { beforeEach, describe, expect, test } from 'vitest';
import type { CardsPayload, GameCard } from '../../shared/card-schema.js';
import { app, initData } from '../runtime/data.js';
import { DB } from '../runtime/db.js';
import { S } from '../runtime/state.js';
import { renderBF, renderCZ, renderDM, renderFB, renderIV, renderMA, renderMS } from './modes.js';

/**
 * Characterization tests for the seven mode renderers.
 *
 * Every mode hand-rolls the same card scaffolding — the wrap, the HUD, the qcard, the direction
 * label, the category chip, the timeout hook, the Next button — seven times over. The plan is to
 * pull that into a shared builder, and the whole point of these tests is that they describe the
 * OUTPUT rather than the implementation: they should pass unchanged after that refactor. If they
 * don't, the refactor changed what the player sees, which is the thing we are trying not to do.
 *
 * They are also the only tests this client has ever had.
 */

const card = (over: Partial<GameCard> = {}): GameCard => ({
  id: 'A1',
  cat: 'A',
  topic: 'Load balancer',
  back: '<p>Spreads traffic across servers.</p>',
  printBack: '<p>Spreads traffic across servers.</p>',
  backMasked: '<p>Spreads traffic across [___].</p>',
  cloze: null,
  chars: 40,
  hint: 'starts with L',
  match: null,
  multi: null,
  mc: null,
  recall: true,
  inverse: true,
  manifest: null,
  ...over,
});

const CLOZE = card({
  id: 'A2',
  cloze: { pre: 'Splitting a dataset across nodes is ', post: '.', answer: 'sharding', alts: ['partitioning'] },
});
const MATCH = card({ id: 'A3', match: [['LB', 'spreads traffic'], ['CDN', 'caches at the edge']] });
const MULTI = card({ id: 'A4', multi: ['availability', 'partition tolerance'] });
const MANIFEST = card({
  id: 'A5',
  manifest: { lines: ['kind: {0}', 'replicas: {1}'], blanks: ['Deployment', '3'], distractors: ['Service'] },
});

const PAYLOAD: CardsPayload = {
  cats: { A: 'Scalability & System Design' },
  catColors: { A: '#5a67f2' },
  // BF picks distractors out of the full card list, so it needs more than one card to choose from.
  cards: [
    card(),
    CLOZE,
    MATCH,
    MULTI,
    MANIFEST,
    card({ id: 'B1', topic: 'Circuit breaker' }),
    card({ id: 'B2', topic: 'Message queue' }),
    card({ id: 'B3', topic: 'Consistent hashing' }),
    card({ id: 'B4', topic: 'Rate limiter' }),
    card({ id: 'B5', topic: 'Bloom filter' }),
  ],
  diagrams: {},
  multiPool: { A4: ['availability', 'partition tolerance', 'consistency', 'durability'] },
};

/** A one-card session, enough for a renderer to draw a card and grade it. */
function startSession(c: GameCard, mode: string): void {
  S.ses = {
    label: 'test',
    deckId: null,
    q: [{ id: c.id, d: mode }],
    i: 0,
    correct: 0,
    missed: [],
    elapsedMs: 0,
    notes: {},
    timeSpeed: 0, // timer off: no countdown fires mid-assertion
  };
  S.curLimit = 0;
}

beforeEach(() => {
  initData(PAYLOAD);
  DB.coins = 0;
  DB.combo = 0;
  DB.stats = {};
});

// (renderer, the card it needs, the label it prints in .dir)
const MODES: [string, (c: GameCard) => void, GameCard, string][] = [
  ['fb', renderFB, card(), 'recall'],
  ['bf', renderBF, card(), 'identify'],
  ['cz', renderCZ, CLOZE, 'fill in'],
  ['ma', renderMA, MATCH, 'match'],
  ['ms', renderMS, MULTI, 'select all'],
  ['iv', renderIV, card(), 'name it'],
  ['dm', renderDM, MANIFEST, 'label the YAML'],
];

describe('every mode draws the same card scaffolding', () => {
  test.each(MODES)('%s', (mode, render, c) => {
    startSession(c, mode);
    render(c);

    // The shell: these five things are what the planned shared builder will own.
    expect(app.querySelector('.wrap'), 'wrap').not.toBeNull();
    expect(app.querySelector('.hud'), 'hud').not.toBeNull();
    expect(app.querySelector('.qcard'), 'qcard').not.toBeNull();
    expect(app.querySelector('.dir'), 'direction label').not.toBeNull();
    expect(app.querySelector('.catchip')?.textContent, 'category chip').toBe('Scalability & System Design');
  });

  test.each(MODES)('%s prints its own direction label', (mode, render, c, label) => {
    startSession(c, mode);
    render(c);
    expect(app.querySelector('.dir')?.textContent).toBe(label);
  });

  test.each(MODES)('%s opens unanswered and installs a timeout hook', (mode, render, c) => {
    startSession(c, mode);
    render(c);
    expect(S.ses!.answered, 'card starts unanswered').toBe(false);
    expect(typeof S.ses!._onTimeout, 'timeout hook installed').toBe('function');
  });

  test.each(MODES)('%s times out into an answered state', (mode, render, c) => {
    startSession(c, mode);
    render(c);

    S.ses!._onTimeout!();

    expect(S.ses!.answered, 'timing out answers the card').toBe(true);
    // A timed-out card is a missed card — never a free pass, and never a payout.
    expect(S.ses!.correct).toBe(0);
    expect(DB.coins).toBe(0);
  });
});

describe('grading and payout', () => {
  test('cz: a correct answer scores, pays, and offers Next', () => {
    startSession(CLOZE, 'cz');
    renderCZ(CLOZE);

    (app.querySelector('#blank') as HTMLInputElement).value = 'sharding';
    (app.querySelector('#submit') as HTMLButtonElement).click();

    expect(S.ses!.correct).toBe(1);
    expect(S.ses!.missed).toEqual([]);
    expect(DB.coins).toBeGreaterThan(0);
    expect(DB.combo).toBe(1);
    expect(app.querySelector('#next'), 'a Next button appears').not.toBeNull();
  });

  test('cz: a wrong answer is recorded missed, pays nothing, and breaks the combo', () => {
    startSession(CLOZE, 'cz');
    DB.combo = 3;
    renderCZ(CLOZE);

    (app.querySelector('#blank') as HTMLInputElement).value = 'replication';
    (app.querySelector('#submit') as HTMLButtonElement).click();

    expect(S.ses!.correct).toBe(0);
    expect(S.ses!.missed).toEqual([CLOZE.id]);
    expect(DB.coins).toBe(0);
    expect(DB.combo).toBe(0);
  });

  test('iv: a correct answer PAYS — the mode used to record the win and grant nothing', () => {
    startSession(card(), 'iv');
    renderIV(card());

    (app.querySelector('#blank') as HTMLInputElement).value = 'load balancer';
    (app.querySelector('#submit') as HTMLButtonElement).click();

    expect(S.ses!.correct).toBe(1);
    expect(DB.coins, 'inverse recall must pay like every other graded mode').toBeGreaterThan(0);
    expect(DB.combo, 'and must advance the combo').toBe(1);
  });

  test('bf: picking the right choice scores and pays; the answer is un-masked', () => {
    const c = card();
    startSession(c, 'bf');
    renderBF(c);

    const correct = [...app.querySelectorAll('.choice')].find(
      (b) => (b as HTMLElement).dataset.topic === c.topic,
    ) as HTMLButtonElement;
    expect(correct, 'the right answer is among the choices').toBeTruthy();
    correct.click();

    expect(S.ses!.correct).toBe(1);
    expect(DB.coins).toBeGreaterThan(0);
    expect(app.querySelector('#bfans')?.innerHTML).toBe(c.back);
    expect([...app.querySelectorAll('.choice')].every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  test('fb: self-graded recall records the answer but never pays', () => {
    const c = card();
    startSession(c, 'fb');
    renderFB(c);

    (app.querySelector('#recall') as HTMLTextAreaElement).value = 'it spreads traffic';
    (app.querySelector('#reveal') as HTMLButtonElement).click();
    (app.querySelector('#got') as HTMLButtonElement).click();

    expect(S.ses!.correct).toBe(1);
    expect(DB.coins, 'recall is honour-graded, so paying it would pay the honour system').toBe(0);
  });
});

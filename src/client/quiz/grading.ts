// Grading + distractor selection: answer normalization, lifetime stats, near-duplicate-aware
// multiple-choice distractors, and record/dispute. Ported verbatim.
import { app, CARDS } from '../runtime/data.js';
import { DB } from '../runtime/db.js';
import { S } from '../runtime/state.js';
import { norm } from '../runtime/util.js';
import { sndCorrect, sndWrong } from '../audio/sound.js';
import { persist } from './session.js';
import type { GameCard } from '../../shared/card-schema.js';

type Cloze = NonNullable<GameCard['cloze']>;

export function czOK(val: string, cz: Cloze): boolean {
  const v = norm(val);
  if (!v) return false;
  if (v === norm(cz.answer)) return true;
  return (cz.alts || []).some((a) => norm(a) === v);
}

/**
 * Grade an inverse-recall answer: the player is shown a definition and types the topic back.
 *
 * Exact match wins outright. Otherwise it is a keyword vote — the "significant" words of the topic
 * (>3 characters, so "the"/"of" cannot carry a pass), of which at least 60% must appear in the
 * answer. That tolerance is why "load balancer" scores against "a load balancer" but not against
 * "balancer" alone in a longer topic.
 *
 * Lived inside renderIV, which meant the one piece of grading logic in this app that is pure and
 * worth testing was the one piece that could not be imported.
 */
export function ivOK(val: string, topic: string): boolean {
  const v = norm(val);
  if (!v) return false;
  const t = norm(topic);
  if (v === t) return true;
  const significant = t.split(' ').filter((w) => w.length > 3);
  if (!significant.length) return false;
  const given = new Set(v.split(' '));
  const hits = significant.filter((w) => given.has(w)).length;
  return hits >= Math.ceil(significant.length * 0.6);
}
export function rate(c: GameCard): number {
  const s = DB.stats[c.id];
  return s && s.seen ? s.missed / s.seen : 0.9;
}
export function lifetime(): string {
  let seen = 0,
    miss = 0;
  for (const id in DB.stats) {
    seen += DB.stats[id].seen;
    miss += DB.stats[id].missed;
  }
  return seen ? `Lifetime ${seen - miss}/${seen} (${Math.round(((seen - miss) / seen) * 100)}%)` : '';
}
const STOP = new Set(
  'the a an of to vs and or in on for with your you it its via how what why not is are be as at by no into per own over off out up so any'.split(
    ' ',
  ),
);
/** The significant words of a string: lowercased, punctuation-stripped, stopwords and stubs dropped. */
export function toks(s: unknown): string[] {
  // norm() already lowercases, collapses every run of non-alphanumerics to ONE space, and trims —
  // so the string it returns can only be separated by single spaces. This used to re-implement
  // norm() and then split on /\s+/, a regex that could never match anything but a single space.
  return norm(s)
    .split(' ')
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** How many significant words `b` shares with an already-tokenised `a`. */
function simWith(a: Set<string>, b: string): number {
  let n = 0;
  for (const w of toks(b)) if (a.has(w)) n++;
  return n;
}
export function distractors(card: GameCard, n: number): GameCard[] {
  // The answer's own tokens, built ONCE. This used to be rebuilt inside sim() on every call, and
  // sim() was called twice per candidate — once to filter and once to score — so a 120-card deck
  // re-tokenised the same topic ~240 times per multiple-choice card. It is now tokenised once, and
  // each candidate is measured once, with the measurement reused for the score.
  const answer = new Set(toks(card.topic));

  // Blacklist NEAR-DUPLICATE topics: a candidate sharing 2+ significant words with the answer
  // is too-similar context and makes the choice ambiguous.
  const pool = CARDS.filter((c) => c.id !== card.id && c.topic !== card.topic)
    .map((c) => ({ c, shared: simWith(answer, c.topic) }))
    .filter((x) => x.shared < 2)
    .map(({ c, shared }) => ({
      c,
      s: (c.cat === card.cat ? 2 : 0) + shared * 1.5 + Math.random() * 0.5,
    }));
  pool.sort((a, b) => b.s - a.s);
  const out: GameCard[] = [],
    seen = new Set([card.topic]);
  for (const { c } of pool) {
    if (out.length >= n) break;
    if (seen.has(c.topic)) continue;
    seen.add(c.topic);
    out.push(c);
  }
  return out;
}
export function record(c: GameCard, ok: boolean): void {
  const ses = S.ses!;
  const s = DB.stats[c.id] || (DB.stats[c.id] = { seen: 0, missed: 0 });
  s.seen++;
  if (!ok) s.missed++;
  if (ok) ses.correct++;
  else if (!ses.missed.includes(c.id)) ses.missed.push(c.id);
  ok ? sndCorrect() : sndWrong();
  persist();
}
export function dispute(c: GameCard, inp: HTMLInputElement | null): void {
  // honor-system override for exact-match fill-in: flip a wrong answer to correct
  const ses = S.ses!;
  const s = DB.stats[c.id];
  if (s && s.missed > 0) s.missed--;
  const k = ses.missed.indexOf(c.id);
  if (k >= 0) ses.missed.splice(k, 1);
  ses.correct++;
  sndCorrect();
  if (inp) {
    inp.classList.remove('wrong');
    inp.classList.add('correct');
  }
  const fb = app.querySelector('#czfb');
  if (fb) fb.innerHTML = `<span class="cz-ok">✓ counted correct (disputed)</span>`;
  persist();
}

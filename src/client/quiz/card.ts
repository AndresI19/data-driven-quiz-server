import type { GameCard } from '../../shared/card-schema.js';
import { breakCombo, grantReward } from '../garden/economy.js';
// The frame every quiz card is drawn in.
//
// All seven modes open the same way (wrap → hud → qcard → direction label → category chip), score
// the same way (record, then pay or break the combo), and end the same way (a feedback line, an
// optional reveal of the answer, and a Next button). Only the middle — how the question is asked and
// answered — is actually different per mode.
//
// That shell used to be hand-written seven times, which is how the modes drifted apart: `iv` quietly
// stopped paying out, and `dm` borrowed `ma`'s payout key. Stating the frame once means a new mode
// gets it right by construction rather than by careful copy-paste.
import { CATS, app } from '../runtime/data.js';
import { S, type Session } from '../runtime/state.js';
import { esc, setKey } from '../runtime/util.js';
import { hud, navKey } from './engine.js';
import { dispute, record } from './grading.js';
import { advance } from './session.js';

/**
 * Draw a card: the shell, with `body` as its question. Returns the session, which every mode aliases
 * as `ses` — and resets `answered`, because a freshly drawn card has not been.
 */
export function drawCard(c: GameCard, dir: string, body: string): Session {
  const ses = S.ses!;
  ses.answered = false;
  app.innerHTML = `<div class="wrap">${hud()}
    <div class="qcard">
      <span class="dir">${esc(dir)}</span>
      <span class="catchip">${esc(CATS[c.cat])}</span>
      ${body}
    </div></div>`;
  return ses;
}

/**
 * Record the answer and settle up.
 *
 * `mode` is the payout key. There is no default: a mode that forgets to name one is exactly the bug
 * this replaces, and an argument the compiler demands cannot be forgotten. Self-graded recall (FB)
 * does not call this at all — it records without paying, because paying for an honour-graded answer
 * would be paying the honour system.
 */
export function score(c: GameCard, ok: boolean, mode: string): void {
  record(c, ok);
  if (ok) grantReward(mode);
  else breakCombo();
}

/** The coloured pass/fail line used by the modes that grade a whole selection at once. */
export function gradeNote(ok: boolean, note: string): string {
  return `<div class="grade-note" style="color:var(--${ok ? 'good' : 'bad'})">${note}</div>`;
}

/**
 * The feedback line used by the typed-answer modes (fill-in, name-it), with the honour-system
 * "I was right" button when the player typed something that was marked wrong. `endCard` wires that
 * button; it is built here so the two live next to each other.
 */
export function typedFeedback(msg: string, canDispute: boolean): string {
  const btn = canDispute
    ? ` <button class="btn ghost sm" id="dispute" title="honor system — count as correct">I was right</button>`
    : '';
  return `<div class="cz-fb" id="czfb">${msg}${btn}</div>`;
}

export interface EndCardOptions {
  /** Show the topic and the full answer under the feedback line. */
  reveal?: boolean;
  /** The input a disputed answer was typed into. Wires the "I was right" button when one is present. */
  disputeInput?: HTMLInputElement;
}

/**
 * Close a card: replace the action bar with the feedback, optionally the answer, and Next.
 *
 * Every mode reaches this point, and every mode used to write these four lines itself — including
 * the `#next → advance` wiring, which is the one line that, if forgotten, strands the player on a
 * finished card with no way forward.
 */
export function endCard(c: GameCard, feedback: string, opts: EndCardOptions = {}): void {
  const reveal = opts.reveal
    ? `<div class="reveal-topic">${esc(c.topic)}</div><div class="answer" style="margin-top:6px">${c.back}</div>`
    : '';
  const next = `<div class="actions"><button class="btn primary" id="next">Next <kbd>→</kbd></button></div>`;

  app.querySelector('#act')!.outerHTML = `${feedback}${reveal}${next}`;
  app.querySelector('#next')!.addEventListener('click', advance);

  const dsp = app.querySelector('#dispute');
  if (dsp && opts.disputeInput) {
    dsp.addEventListener('click', () => dispute(c, opts.disputeInput!));
  }
}

/** The number keys that pick an option, in the order they are drawn. */
const CHOICE_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8'];

/** Which choice a keypress selects, or -1. */
export function choiceIndex(e: KeyboardEvent): number {
  return CHOICE_KEYS.indexOf(e.key);
}

/**
 * Install a mode's key handler behind the two guards every mode needs:
 *
 *  1. typing in the notes textarea is typing, not a shortcut;
 *  2. the global navigation keys get first refusal.
 *
 * `canAdvance` is what navKey is asked about, and it is a parameter rather than a constant for one
 * real reason: every mode passes `answered` — the card is done, so `→` may move on — but RECALL does
 * not. Advancing out of a revealed recall card with `→` would skip the self-grade, so the answer
 * would never be recorded and the stats would quietly drift. Recall passes `false` on purpose.
 */
export function modeKeys(
  fn: (e: KeyboardEvent) => void,
  canAdvance: () => boolean = () => !!S.ses!.answered,
): void {
  setKey((e) => {
    const t = e.target as HTMLElement | null;
    if (t?.classList?.contains('noteta')) return;
    if (navKey(e, canAdvance())) return;
    fn(e);
  });
}

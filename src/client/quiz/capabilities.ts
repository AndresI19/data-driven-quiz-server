import type { GameCard } from '../../shared/card-schema.js';

// The single source of truth for "which quiz modes a card supports", derived from which optional
// fields the card carries. This mapping was previously re-encoded in THREE places — session.pickDir
// (build the mixed-mode list), session.start (filter a deck to one direction), and engine.renderQ
// (downgrade an unsupported requested mode) — which drifted apart easily. Change it once, here.

/** Field requirement for each field-gated mode. `bf` (identify) is always available and not listed.
 *  Open-ended recall (`fb`) was removed — it awarded no points and could not be machine-graded. */
export const MODE_REQUIRES: Record<string, (c: GameCard) => boolean> = {
  cz: (c) => !!c.cloze,
  ma: (c) => !!c.match,
  ms: (c) => !!c.multi,
  iv: (c) => !!c.inverse,
  fl: (c) => !!c.fill,
  cg: (c) => !!c.categorize,
  or: (c) => !!c.order,
  cw: (c) => !!c.code,
  cs: (c) => !!(c.code && c.codeselect),
};

// The field-gated modes in canonical order (matches session.pickDir's original push order, which the
// dashboard and the mixed-mode random pick depend on).
const GATED_MODES = ['cz', 'ma', 'ms', 'iv', 'fl', 'cg', 'or', 'cw', 'cs'] as const;

/** The modes available for a card under the 'mixed' direction: bf (identify) always, plus each gated
 *  mode the card's fields enable. Recall (fb) is intentionally absent so the rotation only ever asks
 *  a machine-gradable, point-awarding question. */
export function availableModes(c: GameCard): string[] {
  return ['bf', ...GATED_MODES.filter((m) => MODE_REQUIRES[m](c))];
}

/** Whether a card supports a specific mode. Ungated modes (fb, bf, anything not in MODE_REQUIRES)
 *  are always supported — matching session.start, which only filters on the gated directions. */
export function supportsMode(c: GameCard, mode: string): boolean {
  return !MODE_REQUIRES[mode] || MODE_REQUIRES[mode](c);
}

/** Downgrade a requested mode to one the card actually supports: cs→cw|bf, everything else gated→bf.
 *  A stale 'fb'/'dm' (from a resumed pre-refactor session) also lands on identify / its replacement. */
export function resolveMode(requested: string, c: GameCard): string {
  if (requested === 'fb') return 'bf'; // recall removed — resume any old fb card as identify
  if (requested === 'dm') return c.fill ? 'fl' : 'bf'; // label-the-YAML folded into fill
  if (MODE_REQUIRES[requested] && !MODE_REQUIRES[requested](c)) {
    if (requested === 'cs') return c.code ? 'cw' : 'bf';
    return 'bf';
  }
  return requested;
}

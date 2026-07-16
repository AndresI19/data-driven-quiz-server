// The garden currency, named in ONE place. Every user-facing "coin"/"coins"/🪙 in the client reads
// from here, so renaming the currency (a made-up name, a different glyph) is a single edit rather than
// a hunt through two dozen template literals. This is display only — the persisted field is still
// `DB.coins` and the server column is still `coins`; those are storage names, not what the player reads.
export const CURRENCY = {
  one: 'coin',
  many: 'coins',
  glyph: '\u{1FA99}', // 🪙
} as const;

/** Shorthand for the inline glyph, e.g. `${COIN}${price}`. */
export const COIN = CURRENCY.glyph;

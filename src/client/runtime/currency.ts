// The garden currency, named in ONE place. Every user-facing "coin"/"coins"/🪙 in the client reads
// from here, so renaming the currency (a made-up name, a different glyph) is a single edit rather than
// a hunt through two dozen template literals. This is display only — the persisted field is still
// `DB.coins` and the server column is still `coins`; those are storage names, not what the player reads.
export const CURRENCY = {
  one: 'coin',
  many: 'coins',
} as const;

/**
 * The coin mark, e.g. `${COIN}${price}`. An inline SVG, NOT the 🪙 emoji it used to be: an emoji is
 * drawn by the OS font, so the same balance looked like a different currency on a phone (Apple/Android
 * glyphs) than on the desktop — the exact inconsistency this replaces. An SVG is the same pixels
 * everywhere. Because it is markup it belongs in innerHTML, never textContent (which would print the
 * tags verbatim) — the two callers that set textContent switched to innerHTML for this reason.
 */
export const COIN =
  '<svg class="coin-ico" viewBox="0 0 16 16" role="img" aria-label="coin">' +
  '<circle cx="8" cy="8" r="7" fill="#f4c542" stroke="#c8971d" stroke-width="1.1"/>' +
  '<circle cx="8" cy="8" r="4.1" fill="none" stroke="#c8971d" stroke-width="1" opacity=".85"/>' +
  '</svg>';

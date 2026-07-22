// Parity check: does loadCardsPayload() over cards/*.yaml reproduce the Python generator's
// game payload byte-for-byte? Compares against the `reference` block dumped by extract-cards.py.
// Usage: tsx scripts/verify-payload.ts <extract.json>
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCardsPayload } from '../src/shared/load-cards.js';
import type { CardsPayload, GameCard } from '../src/shared/card-schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src) throw new Error('pass the extract JSON path (with a .reference block)');

const reference = JSON.parse(readFileSync(src, 'utf8')).reference as CardsPayload;
const mine = loadCardsPayload(resolve(__dirname, '../cards'));

const problems: string[] = [];
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// top-level maps
for (const k of ['cats', 'catColors', 'diagrams', 'multiPool'] as const) {
  if (!eq(mine[k], reference[k])) problems.push(`top-level "${k}" differs`);
}

// cards: same count, same order, same fields
if (mine.cards.length !== reference.cards.length) {
  problems.push(`card count ${mine.cards.length} != reference ${reference.cards.length}`);
}
const FIELDS: (keyof GameCard)[] = [
  'id', 'cat', 'topic', 'back', 'backMasked', 'cloze', 'chars', 'hint', 'match', 'multi', 'mc',
  'recall', 'inverse', 'fill',
];
const n = Math.min(mine.cards.length, reference.cards.length);
for (let i = 0; i < n; i++) {
  const a = mine.cards[i];
  const b = reference.cards[i];
  for (const f of FIELDS) {
    if (!eq(a[f], b[f])) problems.push(`card #${i} (${b.id}) field "${f}" differs`);
  }
}

if (problems.length === 0) {
  console.log(`✓ PARITY: ${mine.cards.length} cards, ${Object.keys(mine.cats).length} sections, ` +
    `${Object.keys(mine.diagrams).length} diagrams — identical to the Python payload.`);
  process.exit(0);
} else {
  console.error(`✗ ${problems.length} difference(s):`);
  for (const p of problems.slice(0, 40)) console.error('  - ' + p);
  if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`);
  // show the first diff in detail
  const m = problems[0].match(/#(\d+) \((\w+)\) field "(\w+)"/);
  if (m) {
    const i = Number(m[1]);
    const f = m[3] as keyof GameCard;
    console.error(`\n--- first diff detail (card ${m[2]}, field ${f}) ---`);
    console.error('mine     :', JSON.stringify(mine.cards[i][f]));
    console.error('reference:', JSON.stringify(reference.cards[i][f]));
  }
  process.exit(1);
}

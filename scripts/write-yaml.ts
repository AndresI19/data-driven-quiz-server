// Reads the JSON produced by extract-cards.py and writes cards/<letter>-<slug>.yaml
// (one per section) plus cards/_diagrams.yaml, using the project's js-yaml.
// Usage: tsx scripts/write-yaml.ts <extract.json>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = resolve(__dirname, '../cards');
mkdirSync(CARDS_DIR, { recursive: true });

const src = process.argv[2];
if (!src) throw new Error('pass the extract JSON path');
const data = JSON.parse(readFileSync(src, 'utf8')) as {
  sections: { key: string; name: string; color: string; cards: unknown[] }[];
  diagrams: Record<string, string>;
};

const slug = (s: string) =>
  s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const dumpOpts: yaml.DumpOptions = { lineWidth: -1, noRefs: true, quotingType: '"' };

for (const sec of data.sections) {
  const file = `${sec.key.toLowerCase()}-${slug(sec.name)}.yaml`;
  const doc = {
    section: { key: sec.key, name: sec.name, color: sec.color },
    cards: sec.cards,
  };
  writeFileSync(resolve(CARDS_DIR, file), yaml.dump(doc, dumpOpts), 'utf8');
  console.log(`wrote cards/${file}  (${sec.cards.length} cards)`);
}

writeFileSync(
  resolve(CARDS_DIR, '_diagrams.yaml'),
  yaml.dump(data.diagrams, { ...dumpOpts, lineWidth: -1 }),
  'utf8',
);
console.log(`wrote cards/_diagrams.yaml  (${Object.keys(data.diagrams).length} diagrams)`);

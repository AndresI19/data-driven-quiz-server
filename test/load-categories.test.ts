import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'vitest';
import { loadCardsPayload } from '../src/shared/load-cards.js';

// A throwaway cards/ dir with two labels declared, plus whatever _categories.yaml the test wants.
// Categories own LABELS (not sections), so the fixture has to supply a label registry too.
function fixture(categoriesYaml: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'cards-'));
  writeFileSync(
    join(dir, '_labels.yaml'),
    'labels:\n' +
      '  - { key: one, name: One, color: "#111", desc: first }\n' +
      '  - { key: two, name: Two, color: "#222", desc: second }\n',
  );
  writeFileSync(
    join(dir, 'a-alpha.yaml'),
    'section: { key: A, name: Alpha, color: "#111" }\ncards:\n  - labels: [one]\n    topic: t1\n    desc: d1\n',
  );
  writeFileSync(
    join(dir, 'b-beta.yaml'),
    'section: { key: B, name: Beta, color: "#222" }\ncards:\n  - labels: [two]\n    topic: t2\n    desc: d2\n',
  );
  if (categoriesYaml !== null) writeFileSync(join(dir, '_categories.yaml'), categoriesYaml);
  return dir;
}

test('categories: absent _categories.yaml yields an empty list (backward compatible)', () => {
  const dir = fixture(null);
  try {
    assert.deepEqual(loadCardsPayload(dir).categories, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('categories: a valid manifest parses and preserves order', () => {
  const dir = fixture(
    'categories:\n  - { key: c1, name: One, color: "#0ea5e9", labels: [one] }\n  - { key: c2, name: Two, color: "#ef4444", labels: [two] }\n',
  );
  try {
    const { categories } = loadCardsPayload(dir);
    assert.equal(categories.length, 2);
    assert.deepEqual(
      categories.map((c) => c.key),
      ['c1', 'c2'],
    );
    assert.deepEqual(categories[0].labels, ['one']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('categories: an unknown label is a hard error', () => {
  const dir = fixture('categories:\n  - { key: c1, name: One, color: "#000", labels: [nope] }\n');
  try {
    assert.throws(() => loadCardsPayload(dir), /unknown label "nope"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('categories: a label in two categories is a hard error', () => {
  const dir = fixture(
    'categories:\n  - { key: c1, name: One, color: "#000", labels: [one] }\n  - { key: c2, name: Two, color: "#000", labels: [one, two] }\n',
  );
  try {
    assert.throws(() => loadCardsPayload(dir), /appears in more than one category/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('categories: the shipped deck folds every label into exactly one of 6 categories', () => {
  const { categories, labels } = loadCardsPayload(resolve(__dirname, '../cards'));
  // Pinned on purpose: adding a category should be a deliberate act, not a side effect of adding a
  // label. Update this number when you mean to, which is exactly when this test should fail.
  assert.equal(categories.length, 6);
  const covered = categories.flatMap((c) => c.labels);
  assert.equal(covered.length, new Set(covered).size, 'no label is in two categories');
  assert.deepEqual(
    [...covered].sort(),
    labels.map((l) => l.key).sort(),
    'every declared label belongs to exactly one category',
  );
});

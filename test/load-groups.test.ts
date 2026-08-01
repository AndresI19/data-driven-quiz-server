import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'vitest';
import { loadCardsPayload } from '../src/shared/load-cards.js';

// A throwaway cards/ dir with two minimal sections (A, B) plus whatever _groups.yaml the test wants.
function fixture(groupsYaml: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'cards-'));
  writeFileSync(
    join(dir, 'a-alpha.yaml'),
    'section: { key: A, name: Alpha, color: "#111" }\ncards:\n  - topic: t1\n    desc: d1\n',
  );
  writeFileSync(
    join(dir, 'b-beta.yaml'),
    'section: { key: B, name: Beta, color: "#222" }\ncards:\n  - topic: t2\n    desc: d2\n',
  );
  if (groupsYaml !== null) writeFileSync(join(dir, '_groups.yaml'), groupsYaml);
  return dir;
}

test('groups: absent _groups.yaml yields an empty list (backward compatible)', () => {
  const dir = fixture(null);
  try {
    assert.deepEqual(loadCardsPayload(dir).groups, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('groups: a valid manifest parses and preserves order', () => {
  const dir = fixture(
    'groups:\n  - { key: g1, name: One, color: "#0ea5e9", sections: [A] }\n  - { key: g2, name: Two, color: "#ef4444", sections: [B] }\n',
  );
  try {
    const { groups } = loadCardsPayload(dir);
    assert.equal(groups.length, 2);
    assert.deepEqual(
      groups.map((g) => g.key),
      ['g1', 'g2'],
    );
    assert.deepEqual(groups[0].sections, ['A']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('groups: an unknown section key is a hard error', () => {
  const dir = fixture('groups:\n  - { key: g1, name: One, color: "#000", sections: [A, Z] }\n');
  try {
    assert.throws(() => loadCardsPayload(dir), /unknown section "Z"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('groups: a section in two groups is a hard error', () => {
  const dir = fixture(
    'groups:\n  - { key: g1, name: One, color: "#000", sections: [A] }\n  - { key: g2, name: Two, color: "#000", sections: [A, B] }\n',
  );
  try {
    assert.throws(() => loadCardsPayload(dir), /appears in more than one group/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('groups: the shipped deck folds all 15 sections into 5 roles, each exactly once', () => {
  const { groups, cats } = loadCardsPayload(resolve(__dirname, '../cards'));
  assert.equal(groups.length, 5);
  const covered = groups.flatMap((g) => g.sections);
  assert.equal(covered.length, new Set(covered).size, 'no section is in two groups');
  assert.deepEqual(
    [...covered].sort(),
    Object.keys(cats).sort(),
    'every section belongs to exactly one group',
  );
});

import { beforeEach, describe, expect, test, vi } from 'vitest';

// The export page reads isAdmin to decide whether to render the audit at all, so the gate IS under
// test here — each case sets what it returns.
vi.mock('@platform/ui/auth', () => ({
  isAdmin: vi.fn(() => true),
}));

import { isAdmin } from '@platform/ui/auth';
import { buildAudit, exportPage } from '../src/client/pages/export.js';
import { CATS, app, byId } from '../src/client/runtime/data.js';
import { DB } from '../src/client/runtime/db.js';

const adminMock = isAdmin as unknown as ReturnType<typeof vi.fn>;

/** A card as the runtime holds it — only the fields the audit reads. */
function card(id: string, cat: string, topic: string): void {
  byId[id] = { id, cat, topic } as (typeof byId)[string];
}

beforeEach(() => {
  for (const k of Object.keys(byId)) delete byId[k];
  for (const k of Object.keys(CATS)) delete CATS[k];
  CATS.A = 'Scalability & System Design';
  CATS.B = 'Cloud & Kubernetes';
  card('A1', 'A', 'Stateless vs. stateful applications');
  card('A7', 'A', 'Read replicas');
  card('B12', 'B', 'Pod disruption budgets');
});

describe('buildAudit', () => {
  test('pairs each flagged card with its note', () => {
    const out = JSON.parse(buildAudit(['A1'], { A1: 'the cloze answer is ambiguous' }));
    expect(out.flagged).toBe(1);
    expect(out.cards[0]).toEqual({
      id: 'A1',
      variant: null,
      deck: 'A',
      section: 'Scalability & System Design',
      position: 1,
      topic: 'Stateless vs. stateful applications',
      note: 'the cloze answer is ambiguous',
    });
  });

  test('parses a variant flag key (id:mode) into id + variant', () => {
    const out = JSON.parse(buildAudit(['A1:cg'], { A1: 'the cg distractors are wrong' }));
    expect(out.cards[0]).toMatchObject({ id: 'A1', variant: 'cg', note: 'the cg distractors are wrong' });
  });

  // A bare flag says "something is wrong here" without saying what. It must still export — losing it
  // would silently drop a card the author marked — but it carries no instruction, and null is what
  // says so. An empty string would read as "the note is blank", which is a different claim.
  test('exports a flag with no note as null rather than dropping it', () => {
    const out = JSON.parse(buildAudit(['A1'], {}));
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0].note).toBeNull();
  });

  test('treats a whitespace-only note as no note', () => {
    const out = JSON.parse(buildAudit(['A1'], { A1: '   \n  ' }));
    expect(out.cards[0].note).toBeNull();
  });

  // The whole point of `position`: ids are assigned by array index at load time and stored nowhere,
  // so "A7" means "the 7th card of cards/a-*.yaml" and nothing else. A reader that miscounts edits
  // the wrong card. Two digits must not parse as one.
  test('derives position from the id, past a single digit', () => {
    const out = JSON.parse(buildAudit(['A7', 'B12'], {}));
    expect(out.cards[0].position).toBe(7);
    expect(out.cards[1]).toMatchObject({ deck: 'B', position: 12, section: 'Cloud & Kubernetes' });
  });

  test('falls back to the deck key when the section has no name', () => {
    card('Z3', 'Z', 'Orphaned deck');
    const out = JSON.parse(buildAudit(['Z3'], {}));
    expect(out.cards[0].section).toBe('Z');
  });

  test('emits parseable JSON with a zero count when nothing is flagged', () => {
    const out = JSON.parse(buildAudit([], {}));
    expect(out).toEqual({ flagged: 0, cards: [] });
  });
});

/* The gate, at the seam that decides whether the panel exists. Flagging is admin-only (quiz/engine.ts)
   but a player who flagged cards BEFORE that gate shipped still carries those flags in their synced
   document — so "has flags" does not imply "is admin", and the page must ask rather than infer. */
describe('exportPage — the audit panel', () => {
  const audit = (): HTMLTextAreaElement | null =>
    app.querySelector('#exaudit') as HTMLTextAreaElement | null;

  beforeEach(() => {
    adminMock.mockReturnValue(true);
    DB.flags = {};
    DB.sessions = [];
    DB.active = null;
    app.innerHTML = '';
  });

  test('renders the audit for an admin with flags, holding the JSON', () => {
    DB.flags = { A1: true };
    exportPage();
    const ta = audit();
    expect(ta).not.toBeNull();
    expect(JSON.parse(ta!.value)).toMatchObject({ flagged: 1, cards: [{ id: 'A1' }] });
  });

  test('withholds the audit from a non-admin who still carries flags', () => {
    DB.flags = { A1: true };
    adminMock.mockReturnValue(false);
    exportPage();
    expect(audit()).toBeNull();
  });

  test('withholds the empty audit from an admin with nothing flagged', () => {
    exportPage();
    expect(audit()).toBeNull();
  });

  // The player-facing digest is not part of the gate: notes are everyone's.
  test('renders the note digest either way', () => {
    adminMock.mockReturnValue(false);
    exportPage();
    expect(app.querySelector('#exnotes')).not.toBeNull();
  });
});

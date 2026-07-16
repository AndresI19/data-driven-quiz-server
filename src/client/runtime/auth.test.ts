import { beforeEach, describe, expect, test, vi } from 'vitest';

// pull() reconciles the browser's document with the server. It imports identity from the shared
// platform package; here we replace that package so the test controls who is signed in and what the
// server returns. authFetch is the single network seam — every test sets what it resolves to.
vi.mock('@platform/ui/auth', () => ({
  authFetch: vi.fn(),
  current: vi.fn(() => ({ username: 'admin', version: 1 })),
  isAdmin: vi.fn(() => true),
  isSignedIn: vi.fn(() => true),
  setIdentity: vi.fn(),
}));

import { authFetch } from '@platform/ui/auth';
import { pull } from './auth.js';
import { DB, repairDB } from './db.js';

const fetchMock = authFetch as unknown as ReturnType<typeof vi.fn>;

/**
 * A server document written under an OLDER schema: its one session predates `missedIds`. This is the
 * exact shape that wedged the app — setup() renders the sessions panel and reads `s.missedIds.length`
 * unconditionally, so an undefined `missedIds` threw AFTER the URL had already advanced to /home,
 * leaving the quiz on screen with a dead pause button. It surfaced as "admin-only" because only a
 * signed-in account old enough to have synced this shape ever pulled it back down.
 */
function legacyServerDoc(): Record<string, unknown> {
  return {
    stats: { A1: { seen: 3, missed: 1 } },
    coins: 42,
    sessions: [
      {
        id: 's1',
        label: 'All sections',
        at: '2026-01-01',
        total: 5,
        correct: 3,
        wrong: 2,
        // missedIds intentionally absent — the pre-fix field.
        notes: {},
        noteCount: 0,
        elapsedMs: 1000,
        timeSpeed: 1,
      },
    ],
  };
}

/** authFetch's GET resolves to a server document at the given version. */
function serverReturns(doc: Record<string, unknown> | null, version = 3): void {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ data: doc, version }),
  } as unknown as Response);
}

beforeEach(() => {
  fetchMock.mockReset();
  // Reset the DB singleton to a clean, empty baseline, then normalize gardens/settings.
  DB.sessions = [];
  DB.stats = {};
  DB.coins = 0;
  DB.combo = 0;
  DB.spent = 0;
  DB.active = null;
  repairDB();
});

describe('pull() repairs an adopted server document', () => {
  test('adopt-server branch: a legacy session gains missedIds instead of wedging the app', async () => {
    serverReturns(legacyServerDoc()); // local is empty → pull adopts the server copy

    const outcome = await pull();

    expect(outcome.kind).toBe('adopted-server');
    // The field the UI reads unconditionally is now present and the right type…
    expect(DB.sessions[0].missedIds).toEqual([]);
    // …so the expression that used to throw mid-render is safe.
    expect(() => DB.sessions.map((s) => s.missedIds.length)).not.toThrow();
  });

  test('kept-both branch: adopting over a non-empty local document also repairs it', async () => {
    // A populated local document forces the "both have data" path (server copy wins, local stashed).
    DB.sessions = [
      {
        id: 'local',
        label: 'Local',
        at: '2026-06-01',
        total: 1,
        correct: 1,
        wrong: 0,
        missedIds: [],
        notes: {},
        noteCount: 0,
        elapsedMs: 100,
        timeSpeed: 1,
      },
    ];
    DB.coins = 7;
    serverReturns(legacyServerDoc());

    const outcome = await pull();

    expect(outcome.kind).toBe('kept-both');
    expect(DB.sessions[0].id).toBe('s1'); // the server copy was adopted…
    expect(DB.sessions[0].missedIds).toEqual([]); // …and repaired on the way in
  });
});

describe('repairDB()', () => {
  test('is idempotent and never throws on a legacy shape', () => {
    Object.assign(DB, legacyServerDoc());
    expect(() => {
      repairDB();
      repairDB();
    }).not.toThrow();
    expect(DB.sessions[0].missedIds).toEqual([]);
    expect(Array.isArray(DB.gardens)).toBe(true); // absent gardens were migrated in, not left undefined
  });
});

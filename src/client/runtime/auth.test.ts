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

import { authFetch, current } from '@platform/ui/auth';
import { pull, reconcileOwner } from './auth.js';
import { DB, repairDB } from './db.js';

const fetchMock = authFetch as unknown as ReturnType<typeof vi.fn>;
const currentMock = current as unknown as ReturnType<typeof vi.fn>;

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
  currentMock.mockReturnValue({ username: 'admin', version: 1 }); // default identity for pull() tests
  // Reset the DB singleton to a clean, empty baseline, then normalize gardens/settings.
  DB.sessions = [];
  DB.stats = {};
  DB.coins = 0;
  DB.combo = 0;
  DB.spent = 0;
  DB.active = null;
  DB.owner = undefined;
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

describe('reconcileOwner scopes the document to the identity', () => {
  // A distinctive amount stands in for "this account's data"; a reset zeroes it, a keep preserves it.
  const asUser = (username: string) => currentMock.mockReturnValue({ mode: 'user', username });
  const asGuest = () => currentMock.mockReturnValue({ mode: 'guest' });

  test("another user's document is discarded, not shown as mine", () => {
    DB.owner = 'alice';
    DB.coins = 500;
    DB.grant.login = 'claimed';
    asUser('bob');

    reconcileOwner();

    expect(DB.coins).toBe(0); // alice's wallet did not bleed into bob's session
    expect(DB.grant.login).toBe('none'); // …nor did her claimed grant (bob should still see the mail)
    expect(DB.owner).toBe('bob');
  });

  test('signing out to guest resets the document (the signed-in data is safe on the server)', () => {
    DB.owner = 'alice';
    DB.coins = 500;
    asGuest();

    reconcileOwner();

    expect(DB.coins).toBe(0);
    expect(DB.owner).toBe('guest');
  });

  test("a guest's document is kept and re-tagged when they sign up (the migration is preserved)", () => {
    DB.owner = 'guest';
    DB.coins = 300; // a month of guest play
    asUser('carol');

    reconcileOwner();

    expect(DB.coins).toBe(300); // NOT reset — pull() will upload this as carol's starting document
    expect(DB.owner).toBe('carol');
  });

  test('reloading as the same user keeps the document', () => {
    DB.owner = 'dave';
    DB.coins = 500;
    asUser('dave');

    reconcileOwner();

    expect(DB.coins).toBe(500);
    expect(DB.owner).toBe('dave');
  });

  test('a legacy document with no owner tag is grandfathered, not wiped', () => {
    DB.owner = undefined;
    DB.coins = 500;
    asUser('erin');

    reconcileOwner();

    expect(DB.coins).toBe(500);
    expect(DB.owner).toBe('erin');
  });
});

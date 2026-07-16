import { beforeEach, describe, expect, test, vi } from 'vitest';

// grants.ts reads identity from the shared platform package; replace it so the test controls whether
// the player is signed in or a guest.
vi.mock('@platform/ui/auth', () => ({
  isSignedIn: vi.fn(() => true),
  isGuest: vi.fn(() => false),
}));

import { isGuest, isSignedIn } from '@platform/ui/auth';
import {
  LOGIN_GRANT,
  claimGrants,
  claimableAmount,
  ensureLoginGrant,
  guestWatermarkHtml,
  hasUnclaimed,
  mailButtonHtml,
} from '../src/client/garden/grants.js';
import { CURRENCY } from '../src/client/runtime/currency.js';
import { DB, repairDB } from '../src/client/runtime/db.js';

const signedIn = isSignedIn as unknown as ReturnType<typeof vi.fn>;
const guest = isGuest as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  signedIn.mockReturnValue(true);
  guest.mockReturnValue(false);
  DB.grant = { login: 'none', contact: 'none' };
  DB.coins = 0;
  // Remove only the claim overlay we may have appended — NOT document.body.innerHTML, which would
  // delete the #app element the shared setup plants and break the next test's beforeEach.
  document.querySelectorAll('.grantclaim').forEach((e) => e.remove());
});

describe('ensureLoginGrant', () => {
  test('promotes login none→pending for a signed-in account', () => {
    ensureLoginGrant();
    expect(DB.grant.login).toBe('pending');
  });

  test('is a no-op for a guest (they cannot hold synced coins)', () => {
    signedIn.mockReturnValue(false);
    ensureLoginGrant();
    expect(DB.grant.login).toBe('none');
  });

  test('never resets an already-claimed grant back to pending', () => {
    DB.grant.login = 'claimed';
    ensureLoginGrant();
    expect(DB.grant.login).toBe('claimed');
  });
});

describe('claimGrants', () => {
  test('banks exactly the login grant and marks it claimed', () => {
    DB.grant.login = 'pending';
    claimGrants();
    expect(DB.coins).toBe(LOGIN_GRANT);
    expect(DB.grant.login).toBe('claimed');
    expect(hasUnclaimed()).toBe(false);
  });

  test('double-claim guard: a second claim awards nothing (negative control)', () => {
    DB.grant.login = 'pending';
    claimGrants();
    const afterFirst = DB.coins;
    claimGrants(); // nothing pending now — must be a no-op
    expect(DB.coins).toBe(afterFirst);
  });

  test('contact grant is deferred: only the login grant is claimable', () => {
    DB.grant.login = 'pending'; // contact stays 'none'
    expect(claimableAmount()).toBe(LOGIN_GRANT);
  });
});

describe('repairDB backfills the grant ledger', () => {
  test('a legacy document without DB.grant is defaulted, not left undefined', () => {
    (DB as unknown as { grant?: unknown }).grant = undefined; // simulate an adopted legacy doc
    repairDB();
    expect(DB.grant).toEqual({ login: 'none', contact: 'none' });
  });
});

describe('mail button + guest watermark', () => {
  test('the mail button renders only while unclaimed, and is absent (not a dead icon) once claimed', () => {
    DB.grant.login = 'pending';
    const html = mailButtonHtml();
    expect(html).toContain('gmailrow'); // rendered, in its own row, with the unread dot
    expect(html).toContain('gmail-dot');
    DB.grant.login = 'claimed';
    expect(mailButtonHtml()).toBe(''); // nothing rendered at all once collected
  });

  test('the mail button is absent for a guest', () => {
    signedIn.mockReturnValue(false);
    expect(mailButtonHtml()).toBe('');
  });

  test('the guest watermark shows the 200–400 range and the parameterized currency word', () => {
    guest.mockReturnValue(true);
    const html = guestWatermarkHtml();
    expect(html).toContain('200–400');
    expect(html).toContain(CURRENCY.many);
  });

  test('the guest watermark is absent for a signed-in user', () => {
    guest.mockReturnValue(false);
    expect(guestWatermarkHtml()).toBe('');
  });
});

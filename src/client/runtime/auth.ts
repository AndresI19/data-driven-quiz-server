// Identity and progress sync, from the browser's side.
//
// Three states, and the third one is not a degraded version of the others:
//
//   unchosen  — first visit. The gate asks.
//   guest     — no identity, no server, no row. Everything stays in this browser, and we SAY SO.
//   signed in — username + code, exchanged for a token; the document syncs.
//
// Guest is a first-class choice, not a failure to sign in. The only thing owed to a guest is honesty
// about what happens to their data, which the gate provides in plain words rather than in a footnote.

import { DB, saveDB } from './db.js';

const AUTH_BASE = '/auth'; //  the auth service, behind the same proxy
const KEY = 'quiz:identity';

export interface Identity {
  mode: 'guest' | 'user';
  username?: string;
  /**
   * Yes, the code lives in localStorage — and it is worth being straight about why.
   *
   * The token expires in 24 hours. Without the code stored, the user would have to re-type it every
   * single day, which is a tax steep enough that people would simply stop signing in. With it stored,
   * re-minting is silent.
   *
   * The honest accounting: anything that can read localStorage can already read the TOKEN, and can
   * act as the user until it expires. Storing the code extends that from a day to indefinitely. On a
   * platform whose worst-case loss is a flashcard garden, that is the right trade — and it would NOT
   * be on a platform that held anything else. Which is precisely why this identity is designed to
   * hold nothing else.
   */
  code?: string;
  token?: string;
  expiresAt?: number;
  version?: number;
}

let identity: Identity | null = read();

function read(): Identity | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

function write(id: Identity | null): void {
  identity = id;
  try {
    if (id) localStorage.setItem(KEY, JSON.stringify(id));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the session still works, it just will not be remembered */
  }
}

export const current = (): Identity | null => identity;
export const isGuest = (): boolean => identity?.mode === 'guest';
export const isSignedIn = (): boolean => identity?.mode === 'user' && Boolean(identity.token);

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${AUTH_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(typeof json.error === 'string' ? json.error : `HTTP ${r.status}`);
  return json as T;
}

export async function checkUsername(username: string): Promise<{ valid: boolean; available: boolean }> {
  const r = await fetch(`${AUTH_BASE}/usernames/${encodeURIComponent(username)}`);
  return (await r.json()) as { valid: boolean; available: boolean };
}

/** Sign up. Returns the code — the ONLY time it is ever available. Show it, and say what it means. */
export async function signUp(username: string): Promise<{ username: string; code: string }> {
  const res = await post<{ username: string; code: string; token: string; expiresIn: number }>(
    '/identities',
    { username },
  );
  write({
    mode: 'user',
    username: res.username,
    code: res.code,
    token: res.token,
    expiresAt: Date.now() + res.expiresIn * 1000,
  });
  return { username: res.username, code: res.code };
}

export async function signIn(username: string, code: string): Promise<void> {
  const res = await post<{ username: string; token: string; expiresIn: number }>('/token', {
    username,
    code,
  });
  write({
    mode: 'user',
    username: res.username,
    code,
    token: res.token,
    expiresAt: Date.now() + res.expiresIn * 1000,
  });
}

export function continueAsGuest(): void {
  write({ mode: 'guest' });
}

export function signOut(): void {
  // Deliberately does NOT wipe the local document. Signing out is "stop syncing", not "destroy my
  // garden" — and a control that silently deletes a year of play would be a cruel thing to put next
  // to a control that does not.
  write(null);
}

/** Re-mint silently when the token is close to expiry. The code is what makes this possible. */
async function freshToken(): Promise<string | null> {
  if (!identity || identity.mode !== 'user') return null;
  const soon = Date.now() + 60_000;
  if (identity.token && (identity.expiresAt ?? 0) > soon) return identity.token;
  if (!identity.username || !identity.code) return null;
  try {
    await signIn(identity.username, identity.code);
    return identity.token ?? null;
  } catch {
    return null;
  }
}

/* ── Progress sync ─────────────────────────────────────────────────────────────────────────────── */

export type PullOutcome =
  | { kind: 'adopted-server' }        // the server had data; we took it
  | { kind: 'uploaded-local' }        // the server had nothing; the browser's data became the account
  | { kind: 'kept-both'; backupKey: string } // BOTH had data — nothing was destroyed; see below
  | { kind: 'offline' };

/** Is the local document essentially untouched? A fresh browser has no sessions and no coins. */
function localIsEmpty(): boolean {
  return (DB.sessions?.length ?? 0) === 0 && (DB.coins ?? 0) === 0 && Object.keys(DB.stats ?? {}).length === 0;
}

/**
 * Reconcile on sign-in. This is the moment a garden can be lost, so it is the moment to be careful.
 *
 *   server empty              → upload what is in the browser. This IS the migration path: an
 *                               existing player signs in and their history simply becomes the account.
 *   local empty               → adopt the server. A new browser for an existing account.
 *   BOTH have data            → take the server's, and STASH the local one under a backup key first.
 *                               Merging two gardens automatically is not possible without inventing a
 *                               rule nobody asked for; overwriting silently is not acceptable. So we
 *                               keep both and tell the user where the other one went.
 */
export async function pull(): Promise<PullOutcome> {
  const token = await freshToken();
  if (!token) return { kind: 'offline' };

  const r = await fetch(`${window.location.pathname.replace(/\/$/, '')}/api/progress`, {
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!r || !r.ok) return { kind: 'offline' };

  const { data, version } = (await r.json()) as { data: Record<string, unknown> | null; version: number };

  if (!data) {
    write({ ...identity!, version: 0 });
    await push();
    return { kind: 'uploaded-local' };
  }

  if (localIsEmpty()) {
    Object.assign(DB, data);
    saveDB();
    write({ ...identity!, version });
    return { kind: 'adopted-server' };
  }

  const backupKey = `quiz:backup:${Date.now()}`;
  try {
    localStorage.setItem(backupKey, JSON.stringify(DB));
  } catch {
    /* out of quota — proceed anyway; the server copy is the one being kept */
  }
  Object.assign(DB, data);
  saveDB();
  write({ ...identity!, version });
  return { kind: 'kept-both', backupKey };
}

let pushTimer: number | undefined;
let pushing = false;

/** Debounced. Every card answered writes the document; we do not need to write it to the network. */
export function schedulePush(): void {
  if (!isSignedIn()) return; // guests never touch the network. That is the whole promise.
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => void push(), 2_000);
}

export async function push(): Promise<'ok' | 'conflict' | 'offline'> {
  if (!isSignedIn() || pushing) return 'offline';
  const token = await freshToken();
  if (!token) return 'offline';

  pushing = true;
  try {
    const r = await fetch(`${window.location.pathname.replace(/\/$/, '')}/api/progress`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: DB, version: identity?.version ?? 0 }),
    });

    if (r.status === 409) {
      // Somebody wrote from another browser. The server refused rather than clobbering — which is
      // the whole point of the version. Take what it has, keeping a local backup, and carry on.
      await pull();
      return 'conflict';
    }
    if (!r.ok) return 'offline';

    const { version } = (await r.json()) as { version: number };
    write({ ...identity!, version });
    return 'ok';
  } catch {
    return 'offline';
  } finally {
    pushing = false;
  }
}

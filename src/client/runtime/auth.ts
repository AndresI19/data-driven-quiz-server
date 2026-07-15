// Progress sync. IDENTITY is not defined here — it comes from @platform/ui, shared with every other
// front end, so a sign-out means the same thing on the home page as it does in the quiz.
//
// What IS here is the part only the quiz has: reconciling a player's document with the server.

import { authFetch, current, isAdmin, isSignedIn, setIdentity } from '@platform/ui/auth';
import { DB, saveDB } from './db.js';

// The app's mount prefix (Vite's baked-in base, always trailing-slashed; '/' at root) — NOT
// window.location.pathname. The pathname is the live SPA route (/home, /quiz, …), so reading it here
// baked the current route into the endpoint after a refresh on a subroute — e.g.
// '/cloud-developer-quiz/home/api/progress', a guaranteed 404. Every other URL in the client
// (cards.json, assets, print.html) is built from BASE_URL for exactly this reason.
const API = `${import.meta.env.BASE_URL}api/progress`;

export type PullOutcome =
  | { kind: 'adopted-server' }
  | { kind: 'uploaded-local' }
  | { kind: 'kept-both'; backupKey: string }
  | { kind: 'offline' };

/** A fresh browser: no sessions, no coins, no stats. */
function localIsEmpty(): boolean {
  return (
    (DB.sessions?.length ?? 0) === 0 && (DB.coins ?? 0) === 0 && Object.keys(DB.stats ?? {}).length === 0
  );
}

/**
 * Reconcile on sign-in. This is the moment a garden can be lost, so it is the moment to be careful.
 *
 *   server empty   → upload the browser's document. This IS the migration: a guest who played for a
 *                    month and then signs up keeps everything.
 *   local empty    → adopt the server. A new browser for an existing account.
 *   BOTH have data → take the server's, having STASHED the local one first. Merging two gardens
 *                    automatically means inventing a rule nobody asked for; overwriting one in
 *                    silence is the single worst thing this app could do. So we keep both, and say so.
 */
export async function pull(): Promise<PullOutcome> {
  const r = await authFetch(API);
  if (!r || !r.ok) return { kind: 'offline' };

  const { data, version } = (await r.json()) as {
    data: Record<string, unknown> | null;
    version: number;
  };
  const id = current();
  if (!id) return { kind: 'offline' };

  if (!data) {
    setIdentity({ ...id, version: 0 });
    await push();
    return { kind: 'uploaded-local' };
  }

  if (localIsEmpty()) {
    Object.assign(DB, data);
    if (!isAdmin() && DB.infinite) DB.infinite = false; // the invariant survives a synced document
    saveDB();
    setIdentity({ ...id, version });
    return { kind: 'adopted-server' };
  }

  const backupKey = `quiz:backup:${Date.now()}`;
  try {
    localStorage.setItem(backupKey, JSON.stringify(DB));
  } catch {
    /* out of quota — proceed; the server copy is the one being kept */
  }
  Object.assign(DB, data);
  if (!isAdmin() && DB.infinite) DB.infinite = false; // the invariant survives a synced document
  saveDB();
  setIdentity({ ...id, version });
  return { kind: 'kept-both', backupKey };
}

let timer: number | undefined;
let inFlight = false;

/** Debounced. Every answered card writes the document; it need not write it to the network. */
export function schedulePush(): void {
  if (!isSignedIn()) return; // a guest never touches the network. That is the promise the gate made.
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void push(), 2_000);
}

export async function push(): Promise<'ok' | 'conflict' | 'offline'> {
  if (!isSignedIn() || inFlight) return 'offline';
  const id = current();
  if (!id) return 'offline';

  inFlight = true;
  try {
    const r = await authFetch(API, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: DB, version: id.version ?? 0 }),
    });
    if (!r) return 'offline';

    if (r.status === 409) {
      // Another browser wrote since we last read. The server refused rather than clobbering — which
      // is the entire point of the version. Take what it has, keeping a backup, and carry on.
      await pull();
      return 'conflict';
    }
    if (!r.ok) return 'offline';

    const { version } = (await r.json()) as { version: number };
    setIdentity({ ...current()!, version });
    return 'ok';
  } catch {
    return 'offline';
  } finally {
    inFlight = false;
  }
}

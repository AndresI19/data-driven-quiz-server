// Progress sync. IDENTITY comes from @platform/ui, shared with every front end, so a sign-out means
// the same thing here as on the home page. What IS here: reconciling a player's document with the server.

import { type Identity, authFetch, current, isAdmin, isSignedIn, setIdentity } from '@platform/ui/auth';
import { DB, repairDB, resetDoc, saveDB } from './db.js';

// The mount prefix (Vite's baked-in base, trailing-slashed; '/' at root) — NOT location.pathname.
// The pathname is the live SPA route (/home, /quiz), so using it would bake the current route into the
// endpoint after a subroute refresh (e.g. '/cloud-developer-quiz/home/api/progress' — a 404). Every
// client URL (cards.json, assets, print.html) is built from BASE_URL for this reason.
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

/** The identity that owns the local document: a username, 'guest', or null when unchosen. */
function ownerId(): string | null {
  const id = current();
  if (!id) return null;
  return id.mode === 'guest' ? 'guest' : (id.username ?? null);
}

/**
 * Scope the browser-global document to the current identity. Called once at boot, BEFORE pull(): a
 * document owned by a DIFFERENT signed-in user is discarded and rebuilt, so one account's garden,
 * coins, and grant never bleed into the next on a shared browser (the real data is safe on that user's
 * server row). A 'guest'-owned doc is exempt (this guest's, or play that pull() migrates on sign-up);
 * a legacy doc with no owner tag is grandfathered to whoever is here now.
 */
export function reconcileOwner(): void {
  const cur = ownerId();
  if (DB.owner && DB.owner !== 'guest' && DB.owner !== cur) resetDoc();
  DB.owner = cur ?? undefined;
  saveDB();
}

/**
 * Adopt a server document into DB: replace it, repair it, tag it as this account's, re-enforce the
 * admin-only infinite-money invariant, persist, and record the identity's new version.
 *
 * Shared by both branches of pull() where "the server copy wins" — they differ only in whether the
 * outgoing local document is stashed as a backup first, which the caller does before calling this.
 */
function adoptServerDoc(id: Identity, data: Record<string, unknown>, version: number): void {
  Object.assign(DB, data);
  repairDB(); // the adopted document gets the same backfill/migration as a local one (see db.ts)
  DB.owner = id.username; // the adopted doc belongs to this account
  if (!isAdmin() && DB.infinite) DB.infinite = false; // the invariant survives a synced document
  saveDB();
  setIdentity({ ...id, version });
}

/**
 * Reconcile on sign-in — the moment a garden can be lost, so the moment to be careful.
 *   server empty   → upload the browser's document. The migration: a guest who signs up keeps it all.
 *   local empty    → adopt the server. A new browser for an existing account.
 *   BOTH have data → take the server's, STASHING the local one first. Auto-merging two gardens invents
 *                    a rule nobody asked for; silently overwriting one is the worst thing this app can
 *                    do. So keep both, and say so.
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
    DB.owner = id.username; // this local doc is now this account's — tag it before it is uploaded
    saveDB();
    setIdentity({ ...id, version: 0 });
    await push();
    return { kind: 'uploaded-local' };
  }

  if (localIsEmpty()) {
    adoptServerDoc(id, data, version);
    return { kind: 'adopted-server' };
  }

  const backupKey = `quiz:backup:${Date.now()}`;
  try {
    localStorage.setItem(backupKey, JSON.stringify(DB));
  } catch {
    /* out of quota — proceed; the server copy is the one being kept */
  }
  adoptServerDoc(id, data, version);
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
      // Another browser wrote since we last read. The server refused rather than clobbering (the point
      // of the version). Take what it has, keeping a backup, and carry on.
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

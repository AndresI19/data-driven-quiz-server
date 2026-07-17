// Boot: fetch the validated card payload, populate the data holders, wire the two global
// listeners (pause button + diagram zoom; P/Escape shortcuts), and mount the home screen.
// Shared platform layers first, this app's stylesheet last — so anything here can override them.
import '@platform/ui/tokens.css';
import '@platform/ui/base.css';
import '@platform/ui/gate.css';
import './styles/game.css';
import { isAdmin, isSignedIn } from '@platform/ui/auth';
import { mountAccountFab, mountGate } from '@platform/ui/gate';
import type { CardsPayload } from '../shared/card-schema.js';
import { recomputeAutotile } from './garden/autotile.js';
import { ensureLoginGrant } from './garden/grants.js';
import { mountParticles } from './garden/particles.js';
import { mountScreenBg } from './garden/screenbg.js';
import { mountDebug } from './pages/debug.js';
import { closePeek } from './quiz/engine.js';
import { closeZoom, openZoom, pauseGame, unpauseGame } from './quiz/pause.js';
import { pull, reconcileOwner, schedulePush } from './runtime/auth.js';
import { app, initData } from './runtime/data.js';
import { DB, onSaved, saveDB } from './runtime/db.js';
import { route } from './runtime/router.js';
import { S } from './runtime/state.js';

async function boot(): Promise<void> {
  app.textContent = 'Loading…';
  let payload: CardsPayload;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/cards.json`);
    payload = (await res.json()) as CardsPayload;
  } catch (err) {
    app.textContent = `Failed to load cards: ${String(err)}`;
    return;
  }
  initData(payload);

  // Re-run water/spire autotiling against the current tile map, so a garden saved under an older
  // (buggy) map self-corrects on load — recomputeAutotile otherwise only runs on edits.
  recomputeAutotile();

  // INVARIANT: only an admin may have infinite currency. A document could carry infinite=true from a
  // synced admin, the old default that shipped true, or a hand-edited backup — so it is enforced here
  // every load, not trusted. Admins keep what they set via the debug menu; everyone else → false.
  // pull() adopts synced documents later and calls saveDB, which re-triggers economy's guard, so a
  // freshly-adopted admin document is not stripped.
  if (!isAdmin() && DB.infinite) DB.infinite = false;

  saveDB();

  // Dev-only build badge (tree-shaken out of the production bundle).
  if (import.meta.env.DEV) {
    const wm = document.createElement('div');
    wm.className = 'devwm';
    wm.textContent = '⚙ DEV MODE';
    document.body.appendChild(wm);
  }
  // The debug menu is an ADMIN tool (grants coins, unlocks gardens, rewrites the document). "Hidden"
  // is the honest word — a client-side check stops a curious player, not a determined one, which is
  // the right level since it only edits data the player already owns. Nothing touching the SERVER is
  // defended this way (see vMCP's server-side admin guard).
  if (isAdmin()) mountDebug();
  mountParticles();
  mountScreenBg();

  // Sync on every save. saveDB is the ONE write point, so this is the only hook needed — debounced,
  // since answering a card writes the document but need not hit the network each time. A guest never
  // reaches the network: the gate's promise, kept in schedulePush.
  onSaved(() => schedulePush());

  // The account FAB replaces the old blocking gate (same as the home page): a wall over the game on
  // arrival scared off more players than it converted. A first visitor is defaulted to guest (silently,
  // inside mountAccountFab) with a one-time red nudge to create a real account. Creating or signing in
  // opens the three-option chooser; its onDone syncs and re-routes. No greetUrl — the greeting belongs
  // to the home page.
  mountAccountFab({
    nudgeGuest: true,
    onUpgrade: () =>
      mountGate({
        onDone: () =>
          void pull().finally(() => {
            ensureLoginGrant(); // in-session sign-in earns the grant NOW, without a page refresh
            route();
          }),
      }),
  });
  // Identity is settled now. Scope the document to it BEFORE pull(): a doc left by a different
  // signed-in user is discarded here so it neither renders as nor uploads into this identity. Runs
  // every load, so a sign-out (which reloads) lands a fresh slate for whoever follows.
  reconcileOwner();
  // A returning signed-in player picks up what another browser did since. A conflict is handled inside
  // pull() by keeping BOTH copies, never overwriting in silence. A guest has nothing to pull; route()
  // at the end of boot renders either way.
  if (isSignedIn())
    void pull().then(() => {
      ensureLoginGrant(); // after pull(), so a server 'claimed' state is not reset to 'pending'
      route();
    });

  app.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (!t.closest) return;
    if (t.closest('#pausebtn')) {
      pauseGame();
      return;
    }
    const dg = t.closest('.diagram');
    if (dg) openZoom(dg.innerHTML);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('zoomov')) {
      closeZoom();
      return;
    }
    if (e.key === 'Escape' && document.getElementById('peekov')) {
      closePeek();
      return;
    }
    if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (S.pausedAt) {
        e.preventDefault();
        unpauseGame();
      } else if (S.running && tag !== 'textarea' && tag !== 'input') {
        e.preventDefault();
        pauseGame();
      }
    } else if (e.key === 'Escape' && S.pausedAt) {
      unpauseGame();
    }
  });

  ensureLoginGrant(); // for the immediate render (offline, or landing straight on /garden); idempotent
  route();
}

boot();

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
import { mountParticles } from './garden/particles.js';
import { mountScreenBg } from './garden/screenbg.js';
import { mountDebug } from './pages/debug.js';
import { closePeek } from './quiz/engine.js';
import { closeZoom, openZoom, pauseGame, unpauseGame } from './quiz/pause.js';
import { pull, schedulePush } from './runtime/auth.js';
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

  // INVARIANT: only an admin may have infinite currency. A document could carry infinite=true from
  // an admin who synced it, from the old default that shipped true, or from a hand-edited backup —
  // so it is enforced here, on every load, rather than trusted. An admin keeps whatever they set via
  // the debug menu; everyone else is corrected to false. This runs BEFORE pull() adopts a synced
  // document too (see below), and pull() calls saveDB which re-triggers this through the guard in
  // economy, so a freshly-adopted admin document is not stripped.
  if (!isAdmin() && DB.infinite) DB.infinite = false;

  saveDB();

  // Dev-only build badge (tree-shaken out of the production bundle).
  if (import.meta.env.DEV) {
    const wm = document.createElement('div');
    wm.className = 'devwm';
    wm.textContent = '⚙ DEV MODE';
    document.body.appendChild(wm);
  }
  // The debug menu is an ADMIN tool: it can grant coins, unlock gardens and rewrite the document.
  // Anyone could open it before. Hidden for everyone else now — and "hidden" is the honest word: it
  // is a client-side check, so it stops a curious player, not a determined one. The debug menu only
  // edits data the player already owns, so that is the right level of protection for it. Nothing that
  // touches the SERVER is defended this way (see vMCP's admin guard, which is server-side).
  if (isAdmin()) mountDebug();
  mountParticles();
  mountScreenBg();

  // Sync on every save. saveDB is the ONE write point in this app, so this is the one hook needed —
  // and it is debounced, because answering a card writes the document and we do not need to write the
  // document to the network on every card. A guest never reaches the network at all: that is the
  // promise the gate makes, and schedulePush is where it is kept.
  onSaved(() => schedulePush());

  // The account FAB replaces the old blocking gate — the same behaviour as the home page. That gate
  // was a decision about where your progress lives, but a wall over the game on arrival scares more
  // players off than it converts: a first visitor is now defaulted to guest (silently, inside
  // mountAccountFab) and the FAB wears a one-time red nudge to create a real account. Creating or
  // signing in opens the original three-option chooser; its onDone syncs and re-routes. No greetUrl:
  // the greeting belongs to the home page, and account creation stays two pages.
  mountAccountFab({
    nudgeGuest: true,
    onUpgrade: () => mountGate({ onDone: () => void pull().finally(() => route()) }),
  });
  // A returning signed-in player picks up whatever another browser did since last time. A conflict is
  // handled inside pull() by keeping BOTH copies — never by overwriting one in silence. A guest has
  // nothing to pull; route() at the end of boot renders either way.
  if (isSignedIn()) void pull().then(() => route());

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

  route();
}

boot();

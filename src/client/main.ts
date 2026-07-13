// Boot: fetch the validated card payload, populate the data holders, wire the two global
// listeners (pause button + diagram zoom; P/Escape shortcuts), and mount the home screen.
// Shared platform layers first, this app's stylesheet last — so anything here can override them.
import '@platform/ui/tokens.css';
import '@platform/ui/base.css';
import '@platform/ui/gate.css';
import './styles/game.css';
import { app, initData } from './runtime/data.js';
import { S } from './runtime/state.js';
import { onSaved, saveDB } from './runtime/db.js';
import { isAdmin, isSignedIn } from '@platform/ui/auth';
import { mountAccountFab, mountGate, needsGate } from '@platform/ui/gate';
import { pull, schedulePush } from './runtime/auth.js';
import { recomputeAutotile } from './garden/autotile.js';
import { route } from './runtime/router.js';
import { mountDebug } from './pages/debug.js';
import { mountScreenBg } from './garden/screenbg.js';
import { mountParticles } from './garden/particles.js';
import { pauseGame, unpauseGame, openZoom, closeZoom } from './quiz/pause.js';
import { closePeek } from './quiz/engine.js';
import type { CardsPayload } from '../shared/card-schema.js';

async function boot(): Promise<void> {
  app.textContent = 'Loading…';
  let payload: CardsPayload;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/cards.json`);
    payload = (await res.json()) as CardsPayload;
  } catch (err) {
    app.textContent = 'Failed to load cards: ' + String(err);
    return;
  }
  initData(payload);

  // Re-run water/spire autotiling against the current tile map, so a garden saved under an older
  // (buggy) map self-corrects on load — recomputeAutotile otherwise only runs on edits.
  recomputeAutotile();
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

  // The gate: shown once, on the first visit, and never again once a choice has been made. It renders
  // over the app rather than instead of it — this is a decision about where your progress lives, not
  // a paywall, and it should not look like one.
  if (needsGate()) {
    // No greetUrl here: the greeting belongs to the home page, and asking twice would be rude.
    mountGate({
      onDone: () => {
        mountAccountFab();
        void pull().finally(() => route());
      },
    });
  } else if (isSignedIn()) {
    mountAccountFab();
    // A returning player: pick up whatever another browser did since last time. A conflict is handled
    // inside pull() by keeping BOTH copies — never by overwriting one in silence.
    void pull().then(() => route());
  } else {
    mountAccountFab(); // a guest still gets the chip: it is how they upgrade, or see what they chose
  }

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
      const tag = ((document.activeElement && document.activeElement.tagName) || '').toLowerCase();
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

import { enterGarden } from '../garden/page.js';
import { setup } from '../pages/home.js';
import { renderQ } from '../quiz/engine.js';
import { resumeSnap, start } from '../quiz/session.js';
import { DB } from './db.js';
// Minimal history-API router. Each top-level page announces its own URL via setPath() when it
// renders, so both direct calls (button clicks) and route() (deep-links / back-forward) keep the
// address bar in sync. route() maps the current path to a page; popstate re-routes.
import { S } from './state.js';

let routing = false;

// The app may be served under a URL prefix (e.g. '/cloud-developer-quiz/') behind a reverse proxy.
// Vite bakes that prefix into import.meta.env.BASE_URL (always trailing-slashed; '/' when at root).
// Internal route paths ('/home', '/garden', …) stay prefix-free; these two helpers translate to and
// from the on-the-wire location.pathname so every call site can ignore the base entirely.
const BASE = import.meta.env.BASE_URL;
// endsWith/slice, not a regex — the function right below already strips the prefix with
// startsWith/slice, and the file was doing the mirror operation two different ways.
const BASE_NOSLASH = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE; // '' at root, else '/cloud-developer-quiz'

/** Internal route path ('/home') → full location path ('/cloud-developer-quiz/home'). */
function toUrl(path: string): string {
  return BASE_NOSLASH + path;
}
/** Current location.pathname → internal route path, with the base prefix stripped. */
function toRoute(pathname: string): string {
  let p = pathname;
  if (BASE_NOSLASH && p.startsWith(BASE_NOSLASH)) p = p.slice(BASE_NOSLASH.length) || '/';
  return p.startsWith('/') ? p : `/${p}`;
}

/** A page calls this at the top of its render to reflect itself in the URL (no-op while routing). */
export function setPath(path: string): void {
  if (routing) return;
  const url = toUrl(path);
  if (location.pathname !== url) history.pushState({}, '', url);
}

/** /quiz: show the active session, resume a saved one, or start a fresh quiz with current config. */
function quizRoute(): void {
  if (S.ses) renderQ();
  else if (DB.active) resumeSnap(DB.active, DB.active.deckId);
  else start();
}

/** Render whichever page the current URL names. Suppresses setPath so it doesn't re-push. */
export function route(): void {
  routing = true;
  try {
    let p = toRoute(location.pathname);
    if (p === '/') {
      history.replaceState({}, '', toUrl('/home'));
      p = '/home';
    }
    if (p === '/garden') enterGarden();
    else if (p === '/quiz') quizRoute();
    else setup(); // /home and anything unrecognized
  } finally {
    routing = false;
  }
}

window.addEventListener('popstate', route);

import { afterEach, describe, expect, test } from 'vitest';
import { S } from '../runtime/state.js';
import { dismissTransients } from './pause.js';

// dismissTransients is the guard against a class of "dead click" bug: pause / peek-back / diagram-zoom
// are all position:fixed full-screen CLICKABLE overlays, and each once relied solely on its own close
// button to go away. A navigation that skipped that path (a browser Back firing popstate, any
// re-render) left one orphaned on top of the next page, silently swallowing every click. Every
// navigation entry now calls this first, so these characterize the promise it makes.

const overlay = (id: string): void => {
  const el = document.createElement('div');
  el.id = id;
  document.body.appendChild(el);
};

afterEach(() => {
  for (const id of ['pauseov', 'peekov', 'zoomov']) document.getElementById(id)?.remove();
  S.pausedAt = 0;
});

describe('dismissTransients', () => {
  test('removes every transient full-screen overlay', () => {
    overlay('pauseov');
    overlay('peekov');
    overlay('zoomov');
    dismissTransients();
    expect(document.getElementById('pauseov')).toBeNull();
    expect(document.getElementById('peekov')).toBeNull();
    expect(document.getElementById('zoomov')).toBeNull();
  });

  test('clears the paused flag so the pause button is not left short-circuited', () => {
    S.pausedAt = 1234;
    dismissTransients();
    expect(S.pausedAt).toBe(0);
  });

  test('is a no-op when nothing is open (safe to call on every navigation)', () => {
    expect(() => dismissTransients()).not.toThrow();
    expect(document.body.querySelector('#peekov')).toBeNull();
  });
});

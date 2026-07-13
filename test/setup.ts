import { beforeEach, vi } from 'vitest';

// runtime/data.ts does `document.getElementById('app')` at MODULE LOAD, so the element has to exist
// before the first import of anything that reaches it. setupFiles run before the test module is
// imported, which is the only hook early enough to do this.
document.body.innerHTML = '<div id="app"></div>';

/**
 * A real localStorage.
 *
 * happy-dom 15 exposes a `localStorage` object with no `clear()` on it, and the quiz's entire
 * persistence layer (runtime/db.ts) is localStorage-backed — so rather than test against a
 * half-implemented shim, install a complete Map-backed Storage. It is ~15 lines, it is exactly the
 * spec'd behaviour, and it makes each test's starting state something we control rather than
 * something the environment happens to provide.
 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(String(k), String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  [name: string]: unknown;
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });

// The sound module builds a Web Audio graph, which happy-dom has no implementation for. Grading
// calls sndCorrect/sndWrong on every answer, so stub the module: these tests are about what is
// scored and rendered, not what is heard.
vi.mock('../src/client/audio/sound.js', () => ({
  audioInit: vi.fn(),
  setVolume: vi.fn(),
  sndCorrect: vi.fn(),
  sndWrong: vi.fn(),
  sndCoin: vi.fn(),
  sndClick: vi.fn(),
  sndPlace: vi.fn(),
}));

beforeEach(() => {
  // Each test starts from a clean slate: the persisted DB is a module-level singleton hydrated from
  // localStorage, so leaked state between tests would make them order-dependent.
  localStorage.clear();
  // Empty #app rather than REPLACE it — runtime/data.ts captured this exact element in a module
  // const, and swapping it out would leave every renderer writing into a detached node.
  document.getElementById('app')!.innerHTML = '';
});

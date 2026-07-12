// Routing smoke test over CDP: deep-links to each URL, click-nav, and browser back.
// Usage: node scripts/smoke-routing.mjs http://localhost:PORT
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:3999';
const PORT = 9377;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const udir = mkdtempSync(join(tmpdir(), 'brave-route-'));
const brave = spawn('/usr/bin/brave-browser', ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`, `--user-data-dir=${udir}`, 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const evaluate = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result?.value; };
async function findWs() { for (let i = 0; i < 50; i++) { try { const t = await (await fetch(`http://localhost:${PORT}/json`)).json(); const p = t.find((x) => x.type === 'page' && x.webSocketDebuggerUrl); if (p) return p.webSocketDebuggerUrl; } catch {} await wait(200); } throw new Error('no target'); }
const nav = async (url) => { await send('Page.navigate', { url }); await wait(1400); };

async function main() {
  ws = new WebSocket(await findWs());
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  await send('Page.enable'); await send('Runtime.enable');
  const R = {};

  await nav(BASE + '/garden');
  R.garden = await evaluate(`({path:location.pathname, cells:document.querySelectorAll('.gcell').length, palette:document.querySelectorAll('.palbtn').length})`);
  await nav(BASE + '/resume');
  R.resume = await evaluate(`({path:location.pathname, frame:!!document.querySelector('#resframe')})`);
  await nav(BASE + '/quiz');
  R.quiz = await evaluate(`({path:location.pathname, qcard:!!document.querySelector('.qcard')})`);
  await nav(BASE + '/');
  R.rootRedirect = await evaluate(`({path:location.pathname, h1:(document.querySelector('h1')?.textContent||'').slice(0,12), devbadge:document.querySelectorAll('.devwm').length})`);

  // click-nav: home → résumé via the "by Andres" link, then browser Back
  await evaluate(`document.querySelector('#bywm').click()`); await wait(600);
  R.clickResume = await evaluate(`({path:location.pathname, frame:!!document.querySelector('#resframe')})`);
  await evaluate(`history.back()`); await wait(700);
  R.back = await evaluate(`({path:location.pathname, h1:(document.querySelector('h1')?.textContent||'').slice(0,12)})`);

  console.log(JSON.stringify(R, null, 2));
  const P = [];
  if (R.garden.path !== '/garden' || R.garden.cells !== 100) P.push('deep-link /garden failed');
  if (R.resume.path !== '/resume' || !R.resume.frame) P.push('deep-link /resume failed');
  if (R.quiz.path !== '/quiz' || !R.quiz.qcard) P.push('deep-link /quiz failed');
  if (R.rootRedirect.path !== '/home' || !R.rootRedirect.h1.includes('Engineer')) P.push('/ → /home redirect failed');
  if (R.rootRedirect.devbadge !== 0) P.push('DEV badge present in production build!');
  if (R.clickResume.path !== '/resume' || !R.clickResume.frame) P.push('click-nav to résumé failed');
  if (R.back.path !== '/home' || !R.back.h1.includes('Engineer')) P.push('browser Back failed');

  ws.close(); brave.kill('SIGKILL');
  if (P.length) { console.error('\n✗ ROUTING FAILED:\n  - ' + P.join('\n  - ')); process.exit(1); }
  console.error('\n✓ ROUTING PASSED: deep-links, / → /home, click-nav, and Back all work; no DEV badge in prod.');
  process.exit(0);
}
main().catch((e) => { console.error('harness error:', e.message); try { ws?.close(); } catch {} brave.kill('SIGKILL'); process.exit(2); });

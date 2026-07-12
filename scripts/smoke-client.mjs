// Zero-dependency headless smoke test: drives brave-browser over the DevTools protocol
// (Node's global WebSocket) to boot the built app, render the home page, start a quiz, and open
// the garden — asserting each renders and capturing any console errors / exceptions.
// Usage: node scripts/smoke-client.mjs http://localhost:PORT
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_BASE = process.argv[2] || 'http://localhost:3999';
const PORT = 9333;
const BRAVE = '/usr/bin/brave-browser';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const udir = mkdtempSync(join(tmpdir(), 'brave-smoke-'));
const brave = spawn(BRAVE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`, `--user-data-dir=${udir}`,
  'about:blank',
], { stdio: 'ignore' });

let ws, msgId = 0;
const pending = new Map();
const consoleErrors = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('page eval threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}

async function findPageWs() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/json`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await wait(200);
  }
  throw new Error('no devtools page target found');
}

async function main() {
  const wsUrl = await findPageWs();
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value || a.description || '').join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');

  const results = {};

  // ---- 1. Home page ----
  await send('Page.navigate', { url: URL_BASE + '/' });
  await wait(1500);
  results.home = await evaluate(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));
    for(let i=0;i<50&&!document.querySelector('h1');i++)await w(100);
    return {
      h1: document.querySelector('h1')?.textContent||'',
      sub: (document.querySelector('.sub')?.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60),
      tiles: document.querySelectorAll('.homeboard .gart').length,
      startBtn: !!document.querySelector('#start'),
      secchips: document.querySelectorAll('.secchip.sc').length,
      gardenVal: document.querySelector('.gscore')?.textContent||'',
    };})()`);

  // ---- 2. Start a quiz ----
  results.quiz = await evaluate(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));
    document.querySelector('#start').click(); await w(400);
    return {
      qcard: !!document.querySelector('.qcard'),
      dir: document.querySelector('.dir')?.textContent||'',
      hud: !!document.querySelector('.hud'),
      coinbar: !!document.querySelector('#coinbar'),
      progress: document.querySelector('.hud span')?.nextSibling?.textContent||document.querySelectorAll('.hud span')[0]?.textContent||'',
    };})()`);

  // ---- 3. Open the garden (fresh boot, then click the home garden) ----
  await send('Page.navigate', { url: URL_BASE + '/' });
  await wait(1200);
  results.garden = await evaluate(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));
    for(let i=0;i<50&&!document.querySelector('#homegarden');i++)await w(100);
    document.querySelector('#homegarden').click(); await w(400);
    return {
      board: !!document.querySelector('.boardwrap .gboard'),
      cells: document.querySelectorAll('.gcell').length,
      palette: document.querySelectorAll('.palbtn').length,
      tools: document.querySelectorAll('.palbtn.tool').length,
      animals: document.querySelectorAll('.palbtn.animrow').length,
    };})()`);

  console.log(JSON.stringify({ results, consoleErrors }, null, 2));

  // ---- assertions ----
  const problems = [];
  const H = results.home, Q = results.quiz, G = results.garden;
  if (!H.h1.includes('Engineer')) problems.push('home h1 missing');
  if (H.tiles < 25) problems.push(`home garden tiles=${H.tiles} (<25)`);
  if (!H.startBtn) problems.push('no start button');
  if (H.secchips !== 10) problems.push(`section chips=${H.secchips} (!=10)`);
  if (!Q.qcard) problems.push('quiz card did not render');
  if (!Q.hud) problems.push('quiz hud missing');
  if (!Q.coinbar) problems.push('quiz coinbar missing');
  if (!G.board) problems.push('garden board missing');
  if (G.cells !== 100) problems.push(`garden cells=${G.cells} (!=100)`);
  if (G.palette < 30) problems.push(`palette buttons=${G.palette} (<30)`);
  if (consoleErrors.length) problems.push(`${consoleErrors.length} console error(s)`);

  ws.close();
  brave.kill('SIGKILL');
  if (problems.length) {
    console.error('\n✗ SMOKE FAILED:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
  console.error('\n✓ SMOKE PASSED: home, quiz, and garden all render; no console errors.');
  process.exit(0);
}

main().catch((e) => {
  console.error('smoke harness error:', e.message);
  try { ws?.close(); } catch {}
  brave.kill('SIGKILL');
  process.exit(2);
});

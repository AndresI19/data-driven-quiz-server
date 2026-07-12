// CDP screenshot capture (real-time waits — no virtual-time hang). Captures the new app and the
// original side by side: home + garden. Usage: node scripts/shot.mjs <serverBase> <outDir>
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2];
const OUT = process.argv[3];
const ORIG = 'file:///home/ClaudeSpace/git-workspace/claude-workspace/Study/flashcards-game.html';
const PORT = 9344;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const udir = mkdtempSync(join(tmpdir(), 'brave-shot-'));
const brave = spawn('/usr/bin/brave-browser', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars',
  '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`, `--user-data-dir=${udir}`,
  '--window-size=1440,1300', 'about:blank',
], { stdio: 'ignore' });

let ws, msgId = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
};
async function shot(path) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(path, Buffer.from(r.data, 'base64'));
}
async function findWs() {
  for (let i = 0; i < 50; i++) {
    try {
      const t = await (await fetch(`http://localhost:${PORT}/json`)).json();
      const p = t.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await wait(200);
  }
  throw new Error('no page target');
}
async function nav(url) {
  await send('Page.navigate', { url });
  await wait(1600);
}

async function main() {
  const wsUrl = await findWs();
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  };
  await send('Runtime.enable');
  await send('Page.enable');

  await nav(BASE + '/');
  await shot(join(OUT, 'new-home.png'));
  await evaluate(`document.querySelector('#homegarden').click()`);
  await wait(900);
  await shot(join(OUT, 'new-garden.png'));

  await nav(ORIG);
  await shot(join(OUT, 'orig-home.png'));
  await evaluate(`document.querySelector('#homegarden').click()`);
  await wait(900);
  await shot(join(OUT, 'orig-garden.png'));

  ws.close();
  brave.kill('SIGKILL');
  console.log('captured 4 screenshots');
  process.exit(0);
}
main().catch((e) => { console.error('shot error:', e.message); try { ws?.close(); } catch {} brave.kill('SIGKILL'); process.exit(2); });

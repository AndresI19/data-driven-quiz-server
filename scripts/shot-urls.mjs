// Generic CDP screenshotter (real-time waits — no virtual-time hang).
// Usage: node scripts/shot-urls.mjs <outDir> <url>:<name> [<url>:<name> ...]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2];
const jobs = process.argv.slice(3).map((s) => {
  const i = s.lastIndexOf(':');
  return { url: s.slice(0, i), name: s.slice(i + 1) };
});
const PORT = 9355;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const udir = mkdtempSync(join(tmpdir(), 'brave-shoturls-'));
const brave = spawn('/usr/bin/brave-browser', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars',
  '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`, `--user-data-dir=${udir}`,
  '--window-size=1440,1500', 'about:blank',
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
async function findWs() {
  for (let i = 0; i < 50; i++) {
    try { const t = await (await fetch(`http://localhost:${PORT}/json`)).json(); const p = t.find((x) => x.type === 'page' && x.webSocketDebuggerUrl); if (p) return p.webSocketDebuggerUrl; } catch {}
    await wait(200);
  }
  throw new Error('no page target');
}
async function main() {
  const wsUrl = await findWs();
  ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  await send('Page.enable');
  for (const j of jobs) {
    await send('Page.navigate', { url: j.url });
    await wait(1800);
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: process.env.CAP_FULL === '1' });
    writeFileSync(join(OUT, j.name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('shot', j.name);
  }
  ws.close();
  brave.kill('SIGKILL');
  process.exit(0);
}
main().catch((e) => { console.error('shot error:', e.message); try { ws?.close(); } catch {} brave.kill('SIGKILL'); process.exit(2); });

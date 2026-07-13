import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveClient } from '@platform/ui/server';
import { loadCardsPayload } from '../shared/load-cards.js';
import { buildPrintHtml } from '../print/build-print.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..'); // project root
const CARDS_DIR = resolve(ROOT, 'cards');
const CLIENT_DIR = resolve(ROOT, 'dist/client'); // vite build output (includes /assets)

const app = express();
// 3000, not 80: binding 80 needs root, which is a hostile default for someone who just cloned this
// and ran `npm start`. The container sets PORT=80 explicitly, where it is running as its own user.
const PORT = Number(process.env.PORT) || 3000;

// URL prefix the app is mounted under; must match Vite's `base` (both read BASE_PATH). Defaults to
// the root — on its own the quiz is a whole site. A platform that mounts it under a path supplies
// BASE_PATH, and forwards that prefix unchanged, so every route below hangs beneath it.
const BASE = process.env.BASE_PATH || '/';
const B = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE; // '' at root, else '/cloud-developer-quiz'

// Cards are validated + transformed once at startup, then served as static JSON.
// The print sheet is likewise built once from the same payload.
let cardsJson: string;
let printHtml: string;
function buildCards(): void {
  const payload = loadCardsPayload(CARDS_DIR);
  cardsJson = JSON.stringify(payload);
  printHtml = buildPrintHtml(payload);
}
buildCards();

app.get(`${B}/api/cards.json`, (_req, res) => {
  res.type('application/json');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(cardsJson);
});

// The printable 8-per-page duplex card sheet (standalone document with its own print CSS).
app.get(`${B}/print.html`, (_req, res) => {
  res.type('html');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(printHtml);
});

// The built client, its cache policy, the health probe and the SPA fallback — all shared with the
// home page. Mounted LAST: it ends in a catch-all, so the cards and print routes above must be
// registered first or they would be shadowed by index.html.
serveClient(app, { clientDir: CLIENT_DIR, base: BASE, appName: 'data-driven-quiz-server' });

app.listen(PORT, () => {
  console.log(`data-driven-quiz-server listening on http://localhost:${PORT}${BASE}`);
  if (!existsSync(CLIENT_DIR)) console.log('  (dev: run `npm run dev` for the client with HMR)');
});

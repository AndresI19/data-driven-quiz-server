import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCardsPayload } from '../shared/load-cards.js';
import { buildPrintHtml } from '../print/build-print.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..'); // project root
const CARDS_DIR = resolve(ROOT, 'cards');
const CLIENT_DIR = resolve(ROOT, 'dist/client'); // vite build output (includes /assets)

const app = express();
const PORT = Number(process.env.PORT) || 80; // 80 = standard HTTP; needs privilege (see README)

// URL prefix the app is mounted under (must match Vite's `base`). Trailing-slashed; '/' at root.
// The reverse proxy forwards this prefix unchanged, so every route lives beneath it.
const BASE = process.env.BASE_PATH || '/cloud-developer-quiz/';
const B = BASE.replace(/\/$/, ''); // '' at root, else '/cloud-developer-quiz'

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

app.get(`${B}/api/health`, (_req, res) => res.json({ ok: true }));

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

// Static: the built client (and its bundled assets), mounted under the prefix so requests for
// <base>assets/* resolve (and <base>/ serves index.html). Long cache for hashed assets.
if (existsSync(CLIENT_DIR)) {
  app.use(
    B || '/',
    express.static(CLIENT_DIR, {
      setHeaders(res, path) {
        if (path.includes(`${'/assets/'}`) || /\.[0-9a-f]{8}\./.test(path)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  // SPA fallback for client-routed deep links under the prefix.
  app.get(`${B}/*`, (_req, res) => res.sendFile(resolve(CLIENT_DIR, 'index.html')));
} else {
  app.get(`${B}/*`, (_req, res) =>
    res
      .status(503)
      .send('Client not built yet. Run `npm run build` first (or use `npm run dev` for HMR).'),
  );
}

app.listen(PORT, () => {
  console.log(`flashcards-app serving on http://localhost:${PORT}`);
  if (!existsSync(CLIENT_DIR)) console.log('  (dev: run `npm run dev` for the client with HMR)');
});

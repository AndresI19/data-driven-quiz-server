import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveClient } from '@platform/ui/server';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { buildPrintHtml } from '../print/build-print.js';
import { loadCardsPayload } from '../shared/load-cards.js';
import { migrate, mountProgress, progressEnabled } from './progress.js';

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

// Progress is OPTIONAL and mounted BEFORE serveClient, which ends in a catch-all that would shadow
// it. With no DATABASE_URL the quiz runs exactly as it always has — entirely in the browser — which
// is what keeps a plain `npm run dev` a single command with no infrastructure.
app.set('trust proxy', true); // behind nginx (and Cloudflare in public), so req.ip needs the header
app.use(express.json({ limit: '1mb' }));

// A coarse global cap as defence-in-depth. Generous because this process also serves the SPA's static
// assets and one page load fans out to many requests; real abuse trips it long before a human
// browsing does. Per-process (single replica) — resets on restart, acceptable at this rate.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  // Skip reads: behind Cloudflare's shared edge IPs a per-IP limiter cannot separate clients, so
  // rate-limiting GETs would 429 the liveness polling. Only mutating requests are capped.
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
  validate: { trustProxy: false },
});
app.use(limiter);

if (progressEnabled) {
  void migrate();
  mountProgress(app, B);
  console.log('[quiz] progress sync enabled');
} else {
  console.log('[quiz] progress sync OFF (no DATABASE_URL / AUTH_JWKS_URI) — browser-only, as before');
}

app.get(`${B}/api/cards.json`, (_req, res) => {
  res.type('application/json');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(cardsJson);
});

// The version this image was built from. Baked into /app/VERSION by the Dockerfile, which k8s/deploy.sh
// stamps from the latest git tag (suffixed -snapshot when the source differs from main). Read ONCE at
// startup like the cards — it can't change without a new image. Absent in a dev checkout, so the
// fallback is "snapshot" (an untagged build is not a release), not "unknown".
const VERSION = ((): string => {
  try {
    return readFileSync(resolve(ROOT, 'VERSION'), 'utf8').trim() || 'snapshot';
  } catch {
    return 'snapshot';
  }
})();
app.get(`${B}/version`, (_req, res) => res.json({ version: VERSION }));

// The printable 8-per-page duplex card sheet (standalone document with its own print CSS).
app.get(`${B}/print.html`, (_req, res) => {
  res.type('html');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(printHtml);
});

// The built client, cache policy, health probe, and SPA fallback — all shared with the home page.
// Mounted LAST: its catch-all would shadow the cards and print routes above if they weren't first.
serveClient(app, { clientDir: CLIENT_DIR, base: BASE, appName: 'data-driven-quiz-server' });

app.listen(PORT, () => {
  console.log(`data-driven-quiz-server listening on http://localhost:${PORT}${BASE}`);
  if (!existsSync(CLIENT_DIR)) console.log('  (dev: run `npm run dev` for the client with HMR)');
});

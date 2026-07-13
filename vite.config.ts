import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

// URL prefix the app is served under (behind the reverse proxy). Trailing-slashed. Override with
// BASE_PATH=/ to run at root. Baked into the build (index.html asset URLs + import.meta.env.BASE_URL)
// and mirrored by the Express server + the dev middleware below so dev and prod share one URL scheme.
// The URL prefix this app is mounted under. Defaults to the ROOT: on its own, the quiz is a whole
// site. The platform that hosts it behind a path (/cloud-developer-quiz/) supplies BASE_PATH — the
// app itself must not assume it lives there, or a fresh clone would serve assets from a prefix that
// does not exist.
const BASE = process.env.BASE_PATH || '/';

// Dev-only: serve the same /api/cards.json the Express server serves in production,
// so the client fetches from one URL in both modes (no proxy, no second process).
function cardsApiDev(): Plugin {
  return {
    name: 'cards-api-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(BASE + 'api/cards.json', async (_req, res) => {
        try {
          const { loadCardsPayload } = await server.ssrLoadModule('/src/shared/load-cards.ts');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(loadCardsPayload(resolve(__dirname, 'cards'))));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      // The print sheet — same URL the Express server exposes in production.
      server.middlewares.use(BASE + 'print.html', async (_req, res) => {
        try {
          const { loadCardsPayload } = await server.ssrLoadModule('/src/shared/load-cards.ts');
          const { buildPrintHtml } = await server.ssrLoadModule('/src/print/build-print.ts');
          res.setHeader('Content-Type', 'text/html');
          res.end(buildPrintHtml(loadCardsPayload(resolve(__dirname, 'cards'))));
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err));
        }
      });
    },
  };
}

export default defineConfig({
  base: BASE,
  root: resolve(__dirname, 'src/client'),
  publicDir: resolve(__dirname, 'public'), // public/assets/** → served at <base>assets/**
  plugins: [cardsApiDev()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    outDir: resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
    sourcemap: true,
  },
  // Dev server on the same port as the production Express server (PORT env, default 80),
  // so the URL is identical in both modes. Binding 80 needs privilege — see README.
  server: { host: true, port: Number(process.env.PORT) || 80 },
});

# CLAUDE.md — data-driven-quiz-server

Guidance for Claude Code when working in this repo.

## What this is

A **data-driven** flashcard quiz: drop a YAML file into `cards/` and it becomes a quiz section, with
the question type inferred from which fields each card carries. Plus an isometric garden reward
system. Vanilla TypeScript, Vite client, Express server, zod validation.

**Platform context:** served at `/cloud-developer-quiz/` behind the platform's nginx router. See
`../platform-orchestration/ARCHITECTURE.md`.

## Setup — the submodule is mandatory

```bash
git clone --recurse-submodules …        # or: git submodule update --init --recursive
npm install
```

`vendor/portfolio-home` is a **git submodule** supplying `@platform/ui` (a `file:` dependency). With
it missing, `npm install` fails outright and so does `typecheck` — `tsconfig.json` extends a file
inside the package.

## Commands

```bash
npm run dev         # vite  — NOTE: defaults to port 80, see gotchas
npm run build       # vite build → dist/client
npm start           # tsx src/server/index.ts
npm run serve       # build && start
npm run typecheck   # tsc --noEmit
npm run lint        # biome check src
npm test            # vitest run  (13 files)
```

**Static gates:** `npm run lint` (Biome — import sorting + formatting) and `npm run typecheck`
(`tsc`). Both are enforced by the `typecheck-test` CI job, so run lint before opening a PR.

## The cards/ directory — the whole point of the app

- **10 section decks**, `a-…` through `j-…`. Section order is filename order.
- **Files starting with `_` are not loaded.** `_diagrams.yaml` is a map of inline SVGs that cards
  reference by key; `_example-pack.yaml` is a reference deck demonstrating every card type — copy it
  to `cards/<letter>-<name>.yaml` to activate it.
- Schema is documented in `cards/_schema.md` and enforced by **strict zod** in
  `src/shared/load-cards.ts`. `.strict()` means an unknown or misspelled field is an **error**, not a
  warning.
- **Card IDs are positional** (`A1`, `A2`, …), assigned by array index. Users' favourites and notes
  are keyed by ID in `localStorage`, so **appending is safe; inserting or reordering silently breaks
  saved state.**

## Gotchas — read these before changing anything

- **A bad YAML file fails server boot, not just one request.** In production, `buildCards()` runs at
  module load in `src/server/index.ts`, so a zod validation error takes the whole server down. Run
  `npm start` locally after editing cards.
- **Dev and prod read cards differently.** The Vite dev plugin re-reads YAML **per request** (edit →
  refresh). Production builds the payload **once at startup** and serves it as a static string — a
  card edit needs a **restart**. In the cluster: `kubectl -n platform rollout restart deploy/quiz`.
- **`BASE_PATH` must be identical at build time and run time.** Vite's `base` bakes the prefix into
  asset URLs at *build*; Express mounts the routes beneath it at *run*. A mismatch gives you a page
  whose assets all 404. It is a Docker **build arg AND a runtime env var** for exactly this reason.
- **`serveClient()` must stay last** in `src/server/index.ts` — it ends in a `/*` catch-all that
  would shadow `/api/cards.json` and `/print.html`.
- **`npm run dev` defaults to port 80**, not 3000 (`vite.config.ts` reads `PORT` and falls back to
  80), which needs privileges. The README's "http://localhost:3000" is wrong. Use `PORT=3000 npm run
  dev`.
- **The server is never compiled** — it runs via `tsx`, a devDependency, which is why the runtime
  image deliberately keeps dev deps (`npm ci --include=dev`).
- The health endpoint (`/api/health`) lives in the **vendored `@platform/ui` package**, not in this
  repo's server file.

## Layout

- `src/shared/` — `load-cards.ts` (read + zod-validate + assign IDs), `card-schema.ts`,
  `card-transform.ts`. Pure; shared by the server and the Vite dev middleware.
- `src/client/quiz/` — engine, modes, grading, session, timer, and `capabilities.ts` (the single
  source of truth for which modes a card supports, derived from its fields — used by mode selection,
  deck-direction filtering, and the render fallback).
- `src/client/garden/` — the reward system (autotiler, economy, sprites, particles).
- `src/server/index.ts` — the only server file. `CARDS_DIR` is a **constant** here (`<repo>/cards`),
  not an env var.
- `src/print/build-print.ts` — the printable sheet (8 cards/page, duplex), built once at startup from
  the same payload as the API.

## Routes

`GET {BASE}/api/cards.json` · `GET {BASE}/version` · `GET {BASE}/print.html` · then `serveClient()`
(which adds `{BASE}/api/health`, static assets, and the SPA fallback).

`{BASE}/version` reports what the running image is: a `VERSION` file baked in by the Dockerfile, which
`platform-orchestration/k8s/deploy.sh` stamps from this repo's latest git tag (suffixed `-snapshot`
when the source differs from `main`). It is read once at startup, like the cards. A dev checkout has
no such file and reports `"snapshot"`. The home page's version badges read it via that repo's
`/api/versions`. Note it hangs beneath `BASE` like everything else here, so in the cluster it is
`/cloud-developer-quiz/version`, not `/version`.

## In the cluster

`cards/` is **mounted from a PersistentVolume** over `/app/cards`, so decks can be edited without an
image rebuild. The copy in this repo is the seed default, copied onto the volume once by an
initContainer (`cp -rn` — it never overwrites what is already there). Because cards are read at
startup, a volume edit still needs a `rollout restart`.

# The Engineer's Flashcards

A data-driven flashcard quiz game with an isometric "garden" reward system, served as a
public web app. This is the Node.js/TypeScript successor to the original single-file
Python-generated game (kept intact under `../Study/`).

## Stack

- **Client:** Vanilla TypeScript, bundled by **Vite** (tree-shaking, minification, hashing).
- **Server:** **Express**, serve-only — hosts the built client + the card data. Player
  progress lives in the browser (`localStorage`); no accounts or database.
- **Cards:** authored as **YAML** files dropped into `cards/`, validated on load.

Everything the app needs is inside this project: npm dependencies (with a committed
lockfile), all sprite assets under `public/assets/`, and all card data under `cards/`.
No global installs, no external CDNs.

## Run it (from anywhere): the `flashcards` command

`bin/flashcards` launches the server from any directory. Put its folder on your PATH once:

```bash
# add to ~/.zshrc (adjust the path if you moved the project):
export PATH="$PATH:/home/ClaudeSpace/git-workspace/claude-workspace/flashcards-app/bin"
```

Then, from anywhere:

```bash
flashcards                 # build + serve on http://localhost/home  (production)
flashcards --dev           # dev server: hot reload + a "DEV MODE" badge
flashcards --port 3000     # serve on a non-privileged port (no sudo)
flashcards --help
```

**Port 80** is the default (so the URL is just `http://localhost`). Binding 80 is privileged,
so either run `sudo -E flashcards`, grant node the capability once with
`sudo setcap 'cap_net_bind_service=+ep' "$(command -v node)"`, or use `--port 3000`.
Dev and production serve on the **same port** — only the `--dev` badge (and hot reload)
tells them apart.

## Or use npm directly

```bash
npm install
npm run dev        # Vite dev server (HMR) — PORT env, default 80
npm run serve      # build, then Express serves dist/client — PORT env, default 80
```

## URLs / routes

The client has real history-API routing, so these are deep-linkable and support back/forward:

| URL | Page |
|-----|------|
| `/home` (or `/`) | quiz setup, favorites, sessions, garden mini-render |
| `/quiz` | an in-progress quiz (starts/resumes one if you deep-link here) |
| `/garden` | the isometric garden editor |
| `/resume` | résumé PDF, full-page |
| `/print.html` | printable 8-per-page card sheet (standalone document) |
| `/resume.pdf`, `/api/cards.json` | the raw PDF and card data |

## Add cards (plug-and-play)

Drop a `*.yaml` file into `cards/` (one file per section). It's picked up automatically —
no code changes. See `cards/_schema.md` for the schema. Card IDs are derived per-section
from file order (`A1`, `A2`, …), so keep existing cards in place to preserve saved
favorites/notes.

## Layout

```
bin/          the `flashcards` launcher (put on PATH)
cards/        YAML card data (+ _diagrams.yaml, _schema.md)
public/       resume.pdf + assets/ (tiles, critters, decor) — served at web root
src/shared    card types, YAML loader, transforms (used by build + server)
src/client    the browser app (state, quiz, garden, audio, pages, styles)
src/server    the Express host
src/print     the printable 8-per-page card sheet
scripts       parity checks vs the original game
```

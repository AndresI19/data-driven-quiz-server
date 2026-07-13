# Cloud Developer Quiz

A flashcard quiz for cloud and system-design interview prep, with an isometric garden you grow by
answering correctly. Vanilla TypeScript, Vite, and a small Express server — no framework, no database,
no accounts. A player's progress lives in their own browser's `localStorage`.

**The quiz is data.** You do not write code to add questions. You drop a YAML file into
[`cards/`](cards/), and the app grows a new section, works out what *kinds* of question each card can
be asked as, and wires it into the study deck, the printable sheet, and the reward economy.

---

## Quick start

```bash
git clone --recurse-submodules https://github.com/AndresI19/flashcards-app.git
cd flashcards-app
npm install
npm run dev            # http://localhost:3000
```

> **`--recurse-submodules` matters.** The shared design system,
> [`@platform/ui`](https://github.com/AndresI19/platform-ui), is a submodule at `vendor/platform-ui`,
> and `npm install` resolves the dependency from there. Already cloned without it?
> `git submodule update --init --recursive`

```bash
npm run build && npm start     # production build, served by Express
npm test                       # 115 tests
npm run typecheck
```

---

## The data-driven part

### Adding a section

Drop a file into `cards/`. That is the whole procedure — there is no registry to update.

```yaml
# cards/k-my-topic.yaml
section:
  key: K                  # card ids become K1, K2, …
  name: My Topic          # the label on the section chip
  color: '#c08a12'        # the chip's colour

cards:
  - topic: Idempotency
    desc: An operation that can be applied many times without changing the result beyond the first.
```

- Files load in **filename order**, so the leading letter orders the sections (`a-…`, `b-…`, `k-…`).
- Files beginning with `_` are **not** loaded. That is how [`_schema.md`](cards/_schema.md) (the full
  field reference), [`_example-pack.yaml`](cards/_example-pack.yaml) (a worked example of every card
  type) and [`_diagrams.yaml`](cards/_diagrams.yaml) (inline SVGs a card can reference by name) live
  in the directory without becoming questions.
- Every file is schema-validated on load. A malformed card **fails the boot naming the file, the card
  index and the field** — it never silently ships a broken question.

### The question type is inferred from the fields you write

A card is never tagged with a mode. It is *capable* of the modes its data supports, and the quiz picks
one at random each time the card comes up. Author more fields, earn more ways to be tested.

| Write this field | …and the card can also be asked as |
|---|---|
| *(nothing — just `topic` + `desc`)* | **recall** (write it from memory, self-graded) and **identify** (multiple choice) |
| `cloze:` | **fill in the blank** |
| `match:` | **match** — drag an arrow from each term to its pair |
| `multi:` | **select all** — tick every member of a set |
| `manifest:` | **label the YAML** — drag labels into the blanks of a manifest |
| `inverse: true` | **name it** — given the definition, recall the term |
| `mc:` | hand-written wrong answers for *identify*, instead of ones the app picks for you |
| `recall: true` | forces **recall only** — opts the card out of every machine-graded mode |

Two things fall out of this for free:

- **Distractors are pooled across the whole deck.** A `multi:` card's members become decoys for the
  other `multi:` cards, and *identify*'s wrong answers are drawn from cards whose topics are related
  but not *too* similar. Adding a section quietly makes the existing sections harder.
- **The print sheet and the garden come along.** The 8-per-page duplex sheet renders from the same
  payload, and a correct answer pays coins into the garden economy, priced per mode.

[`cards/_schema.md`](cards/_schema.md) is the full field reference;
[`cards/_example-pack.yaml`](cards/_example-pack.yaml) is a copyable example of all eight card types.

### When edits are picked up

| | |
|---|---|
| `npm run dev` | The payload is rebuilt **on every request** to `api/cards.json`. Edit a YAML file, refresh the page. |
| `npm start` / container | Cards are validated and transformed **once at startup**. Restart to pick up an edit — and rebuild the image, since the cards are copied into it. |

---

## Environment variables

There are two, and **neither is a secret.** This app has no credentials, no database, and makes no
outbound network calls.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` (the container sets `80`) | Port the Express server listens on. |
| `BASE_PATH` | `/` | URL prefix the app is mounted under. |

### `BASE_PATH`

Left alone, the quiz is a whole site served from the root. Set it to mount the app under a path behind
a reverse proxy:

```bash
BASE_PATH=/cloud-developer-quiz/ npm run build   # bakes the prefix into the client's asset URLs
BASE_PATH=/cloud-developer-quiz/ npm start       # and mounts every server route beneath it
```

It **must be the same value at build time and at run time.** Vite bakes it into `index.html`'s asset
URLs and into `import.meta.env.BASE_URL`; the server mounts its routes under it. A mismatch serves a
page whose assets 404 — which is why the container takes it as a build arg *and* an env var.

---

## Running it

### Locally

```bash
npm run dev      # Vite dev server, HMR, cards reloaded on every request
npm run serve    # build, then serve the built client with Express
```

`bin/flashcards` is a convenience launcher that does the same from any directory — put `bin/` on your
`PATH` and run `flashcards`, `flashcards --dev`, or `flashcards --port 3000`.

### In a container

The build context is self-contained (the submodule lives inside the repo), so no special flags:

```bash
docker build -t quiz .
docker run -p 8080:80 quiz                    # http://localhost:8080
```

Behind a reverse proxy at a path:

```bash
docker build --build-arg BASE_PATH=/cloud-developer-quiz/ -t quiz .
docker run -e BASE_PATH=/cloud-developer-quiz/ -p 8080:80 quiz
```

### Routes

| Route | |
|---|---|
| `GET /` | the app (client-routed: `/home`, `/quiz`, `/garden` are deep-linkable) |
| `GET /api/cards.json` | the validated, transformed payload the client boots from |
| `GET /api/health` | `{"ok":true}` |
| `GET /print.html` | printable 8-per-page duplex card sheet |

All of them sit beneath `BASE_PATH` when one is set.

---

## Layout

```
cards/                 the quiz, as data — one YAML file per section
  _schema.md             every authorable field
  _example-pack.yaml     a worked example of all eight card types (not loaded)
  _diagrams.yaml         inline SVGs a card can reference by name
public/assets/         sprites: tiles, critters, decor, tools
src/
  shared/                load + validate + transform YAML → the card payload (pure, tested)
  client/
    quiz/                  the seven question modes, grading, the session
    garden/                the isometric garden: catalog, autotiler, sprites, economy
    runtime/               router, persisted store, shared state
    pages/                 home, review, favorites, export
  print/                 the printable sheet
  server/                Express: serves the payload, the print sheet and the built client
vendor/platform-ui/    submodule — shared design tokens, base stylesheet, client middleware
```

## Tests

```bash
npm test       # 115 tests, Vitest + happy-dom
```

The pure core is covered directly: the card transform, the two answer graders, the garden autotiler,
and the reward economy. The seven question modes are covered by characterization tests that assert on
the HTML each one renders — so they survive a refactor of *how* that HTML is built, and fail if what
the player sees changes.

# Card YAML schema

Each `*.yaml` file in this folder is **one section** (a lettered category). Drop a file in,
it's picked up automatically — no code changes. Files whose name starts with `_`
(e.g. `_diagrams.yaml`, this doc) are not treated as section files.

Cards are validated on load against a strict schema (`src/shared/load-cards.ts`): an unknown
or mistyped field fails fast with an error naming the file and the offending card, rather
than silently rendering wrong.

## File shape

```yaml
section:
  key: A                              # single letter — the ID prefix for every card here
  name: "Scalability & System Design" # shown as the category label
  color: "#6366f1"                    # hex; drives the per-section accent
cards:
  - topic: "..."                      # the front of the card (required)
    desc: "..."                       # the main answer text (required in practice)
    # ...optional fields below...
```

## Card IDs are positional

A card's ID is `<section key><position>` — the first card in `a-*.yaml` is `A1`, the second
`A2`, and so on. Saved favorites and notes are keyed by ID, so **keep existing cards in place**
(append new ones at the end) to avoid renumbering and losing that saved progress.

## Card fields

All fields except `topic` are optional. `desc` is effectively required (it's the answer body).

| Field | Type | Purpose |
|-------|------|---------|
| `topic` | string | Card front / the thing being tested. |
| `desc` | string | The answer body. |
| `extras` | list of `{label, text}` | Labeled notes under the answer (e.g. `label: "e.g."`). |
| `items` | list of string | Bulleted list in the answer. |
| `table` | list of rows (list of string) | First row is the header. |
| `diagram` | string | A key into `_diagrams.yaml` (an inline SVG). |
| `match` | list of `[left, right]` | Explicit line-matching pairs (match mode). |
| `multi` | list of string | Explicit multi-select member names (≥3, else the card gets no select-all). |
| `mc` | list of string | Extra distractors for identify mode. |
| `cloze` | `{text, answer, alts?}` | Fill-in-the-blank; `text` holds one `{}` placeholder. |
| `hint` | string | Explicit "where to start" cue (else one is auto-derived from `desc`). |
| `fold` | bool | Tuck extras/diagram behind a "More detail" disclosure. |
| `recall` | bool | Open-recall only — suppresses cloze/match/multi/inverse/manifest. |
| `inverse` | bool | Adds a reverse-recall variant (given the definition, recall the term). |
| `manifest` | `{lines, blanks, distractors?}` | Drag-labels-onto-a-YAML-block question. |
| `code` | `{lang?, text}` | A code block (`text` is the whole block). Enables read-the-code (pick what it does). |
| `codeselect` | `{prompt, answer}` | With `code`: select-the-lines. `answer` is the 0-based indices of the correct lines. |

## Derived behavior (no authoring needed)

An explicit field always wins. These inferences are the *fallback*, for cards that do not author one:
- **match** is auto-derived from a 2-column `table` (≥3 data rows) or from `items` shaped
  `verb — purpose` when the topic mentions "command".
- **multi** is auto-derived from `items` when the topic mentions "framework" or
  "core k8s objects". (Until recently this was the ONLY way to get select-all — an authored
  `multi:` list was accepted by the schema and then silently dropped. It is now honoured.)
- **hint** falls back to a trimmed opener from `desc` when no explicit `hint` is given.
- **identify mode** masks the topic's own words inside the answer automatically.

## Diagrams

`_diagrams.yaml` is a flat `name: "<svg>…</svg>"` map. Reference one from a card with
`diagram: <name>`.

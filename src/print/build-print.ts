// Builds the printable 8-cards-per-page duplex sheet as a standalone HTML document — a port of
// the Python generator's print output (card_front / card_back / BACK_ORDER + the print CSS).
// A screen-only toolbar adds Print and Back; @media print hides it so only the cards print.
import { esc } from '../shared/card-transform.js';
import type { CardsPayload, GameCard } from '../shared/card-schema.js';

// Print CSS — ported verbatim from gen_flashcards.py (the `CSS` string of the print output).
const PRINT_CSS = `
@page { size: Letter; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #111; }
.page {
  width: 8.5in; height: 11in;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: repeat(4, 1fr);
  page-break-after: always;
}
.page:last-child { page-break-after: auto; }
.card { border: 1px dashed #9aa0a6; padding: 0.12in 0.14in; overflow: hidden; position: relative; }
.card.empty { border: 1px dashed #e6e6e6; }
.corner { position: absolute; top: 0.06in; right: 0.1in; font-size: 7pt; font-weight: 700; color: #b7bbc0; letter-spacing: .5px; }
.corner-b { position: absolute; bottom: 0.08in; right: 0.12in; font-size: 8pt; font-weight: 700; color: #b0b4b8; letter-spacing: .5px; }
/* FRONT */
.front { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.front .cat { position: absolute; top: 0.08in; left: 0.12in; font-size: 6.5pt; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: .5px; max-width: 2.3in; line-height: 1.15; }
.front .topic { font-size: 13.5pt; font-weight: 700; line-height: 1.2; }
/* BACK */
.back .desc { font-size: 8.2pt; line-height: 1.32; }
.back .items { margin: 3px 0 0; padding-left: 13px; font-size: 7.6pt; line-height: 1.3; }
.back .items li { margin-bottom: 1px; }
.back .extra { font-size: 7.6pt; line-height: 1.28; margin-top: 3px; }
.back .extra .lbl { font-weight: 700; font-style: italic; color: #445; }
.back .diagram { margin-top: 4px; text-align: center; }
.back .diagram .dg { width: 100%; max-height: 1.05in; }
.back .diagram .dg.dg-tall { max-height: 1.6in; }
.back .tbl { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 6.8pt; }
.back .tbl th, .back .tbl td { border: 1px solid #cdd2d8; padding: 1px 3px; text-align: left; vertical-align: top; line-height: 1.2; }
.back .tbl th { background: #eef1f5; font-weight: 700; }
@media screen {
  body { background: #f2f3f5; padding: 24px; }
  .page { background: #fff; margin: 0 auto 20px; box-shadow: 0 1px 6px rgba(0,0,0,.18); }
}`;

// The screen-only toolbar (Print / Back). Hidden entirely when printing.
const TOOLBAR_CSS = `
.ptoolbar { position: fixed; top: 0; left: 0; right: 0; z-index: 100; display: flex; align-items: center; justify-content: center; gap: 18px; padding: 10px 16px; background: #fff; border-bottom: 1px solid #e5e8f1; box-shadow: 0 1px 8px rgba(0,0,0,.08); font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
.ptoolbar .ptitle { font-size: 13px; color: #5c6576; }
.pbtn { border: 1px solid #d7dbe6; background: #f2f4fb; color: #161922; border-radius: 9px; padding: 7px 15px; font-size: 13.5px; font-weight: 650; cursor: pointer; text-decoration: none; line-height: 1.2; }
.pbtn:hover { border-color: #5a67f2; color: #5a67f2; }
.pbtn.primary { background: #5a67f2; color: #fff; border-color: transparent; }
.pbtn.primary:hover { filter: brightness(1.08); color: #fff; }
@media screen { body { padding-top: 66px; } }
@media print { .no-print { display: none !important; } body { padding: 0; } }`;

const BACK_ORDER = [1, 0, 3, 2, 5, 4, 7, 6];

function chunk<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}
function cardFront(c: GameCard | null, cats: Record<string, string>): string {
  if (!c) return '<div class="card empty"></div>';
  return `<div class="card front"><div class="cat">${esc(cats[c.cat])}</div><div class="topic">${esc(c.topic)}</div><div class="corner-b">${esc(c.id)}</div></div>`;
}
function cardBack(c: GameCard | null): string {
  if (!c) return '<div class="card empty"></div>';
  return `<div class="card back"><div class="corner">${esc(c.id)}</div>${c.printBack}</div>`;
}

/** Full standalone HTML document for the print sheet, built from the card payload. */
export function buildPrintHtml(payload: CardsPayload): string {
  const { cards, cats } = payload;
  const pages: string[] = [];
  for (const group of chunk(cards, 8)) {
    const g: (GameCard | null)[] = [...group, ...Array(8 - group.length).fill(null)];
    pages.push('<div class="page">' + [0, 1, 2, 3, 4, 5, 6, 7].map((i) => cardFront(g[i], cats)).join('') + '</div>');
    pages.push('<div class="page back-page">' + BACK_ORDER.map((i) => cardBack(g[i])).join('') + '</div>');
  }
  const toolbar = `<div class="ptoolbar no-print">
    <a class="pbtn" href="./">← Back to app</a>
    <span class="ptitle">${cards.length} cards · front/back duplex, 8 per page — print double-sided (flip on short edge)</span>
    <button class="pbtn primary" onclick="window.print()">🖨 Print</button>
  </div>`;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cloud Developer Quiz — print sheet</title>
<style>${PRINT_CSS}${TOOLBAR_CSS}</style></head>
<body>
${toolbar}
${pages.join('\n')}
</body>
</html>
`;
}

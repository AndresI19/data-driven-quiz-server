// Pure port of the Python generator's card transforms (gen_flashcards.py): each function mirrors its
// counterpart 1:1 for a byte-identical payload. No I/O, so it unit-tests directly.
import type { AuthoredCard, Code, GameCard } from './card-schema.js';

/** Split an authored code block (one literal string) into lines, dropping any single trailing newline. */
export function codeLines(c: RawCard): Code | null {
  if (!c.code) return null;
  return { lang: c.code.lang, lines: c.code.text.replace(/\n$/, '').split('\n') };
}

/** An authored card plus the fields the transforms need (id, cat). */
export interface RawCard extends AuthoredCard {
  id: string;
  cat: string;
  desc: string; // required once loaded (schema fills empty string if omitted)
}

/** Escapes the five characters Python's html.escape(s, quote=True) does: & < > " ' */
// One character-class pass, not five chained .replace() calls — which only worked while `&` went
// first, so a reordering edit would double-escape the rest. A char class can't be got wrong that way.
const ESC_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
};
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

/**
 * The answer content (desc + items + table + extras + diagram), no id corner.
 * `fold=true` tucks extras/diagram behind a collapsible <details> (game only).
 */
export function backBody(c: RawCard, diagrams: Record<string, string>, fold = false): string {
  const parts: string[] = [`<div class="desc">${esc(c.desc)}</div>`];
  const codeBlock = codeLines(c);
  if (codeBlock) {
    const rows = codeBlock.lines.map((ln) => `<div class="cl">${esc(ln) || '&nbsp;'}</div>`).join('');
    const lang = codeBlock.lang ? ` data-lang="${esc(codeBlock.lang)}"` : '';
    parts.push(`<pre class="codeblock"${lang}>${rows}</pre>`);
  }
  if (c.items?.length) {
    const lis = c.items.map((it) => `<li>${esc(it)}</li>`).join('');
    parts.push(`<ul class="items">${lis}</ul>`);
  }
  if (c.order?.length) {
    // Rendered as an ordered list so the answer body IS the canonical sequence — the reveal after an
    // "order" question and the print sheet both show the steps numbered in their correct order.
    const lis = c.order.map((it) => `<li>${esc(it)}</li>`).join('');
    parts.push(`<ol class="ol-steps">${lis}</ol>`);
  }
  if (c.table?.length) {
    const rows = c.table;
    const head = rows[0].map((h) => `<th>${esc(h)}</th>`).join('');
    const body = rows
      .slice(1)
      .map((r) => `<tr>${r.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`)
      .join('');
    parts.push(`<table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
  }
  const extraParts: string[] = [];
  for (const { label, text } of c.extras ?? []) {
    extraParts.push(`<div class="extra"><span class="lbl">${esc(label)}</span> ${esc(text)}</div>`);
  }
  if (c.diagram) {
    extraParts.push(`<div class="diagram">${diagrams[c.diagram]}</div>`);
  }
  if (fold && extraParts.length) {
    parts.push(`<details class="foldmore"><summary>More detail</summary>${extraParts.join('')}</details>`);
  } else {
    parts.push(...extraParts);
  }
  return parts.join('');
}

/** cloze object {pre,post,answer,alts} from an authored {text,answer,alts?}. */
export function clozeObj(c: RawCard): { pre: string; post: string; answer: string; alts: string[] } | null {
  const t = c.cloze;
  if (!t) return null;
  const parts = t.text.split('{}');
  return { pre: parts[0], post: parts.length > 1 ? parts[1] : '', answer: t.answer, alts: t.alts ?? [] };
}

/** Total textual content length — drives the content-aware timer. */
export function chars(c: RawCard): number {
  let n = c.topic.length + c.desc.length;
  for (const it of c.items ?? []) n += it.length;
  for (const it of c.order ?? []) n += it.length;
  for (const { label, text } of c.extras ?? []) n += label.length + text.length;
  for (const row of c.table ?? []) for (const cell of row) n += cell.length;
  n += c.code?.text.length ?? 0;
  return n;
}

/** A short "where to start" cue. Priority: explicit authored hint, then an auto opener. */
export function hint(c: RawCard): string {
  if (c.hint) return c.hint;
  const d = c.desc.trim();
  if (d.length <= 48) return d;
  let cut = d.slice(0, 48);
  const sp = cut.lastIndexOf(' ');
  if (sp > 18) cut = cut.slice(0, sp);
  return `${cut}…`;
}

/** Line-matching pairs: explicit match=, a 2-column table, or "verb — purpose" command items. */
export function match(c: RawCard): [string, string][] | null {
  if (c.match) return c.match.map((p) => [p[0], p[1]] as [string, string]);
  const t = c.table;
  if (t && t.length >= 4 && t.every((r) => r.length === 2)) {
    const pairs = t
      .slice(1)
      .filter((r) => r[0].trim() && r[1].trim())
      .map((r) => [r[0].trim(), r[1].trim()] as [string, string]);
    if (pairs.length >= 3) return pairs;
  }
  if (c.topic.toLowerCase().includes('command')) {
    const pairs: [string, string][] = [];
    for (const it of c.items ?? []) {
      if (it.includes(' — ')) {
        const idx = it.indexOf(' — ');
        pairs.push([it.slice(0, idx).trim(), it.slice(idx + 3).trim()]);
      }
    }
    if (pairs.length >= 3) return pairs;
  }
  return null;
}

/**
 * Multi-select member names: an explicit `multi:` list, else inferred from `items` for older cards.
 * The explicit branch was once missing — `multi:` was in the schema but only `items` was read, and
 * only when the topic contained "framework"/"core k8s objects", so an authored list silently got no
 * select-all. The inference is kept: ten cards across three sections still rely on it.
 */
export function multi(c: RawCard): string[] | null {
  if (c.multi && c.multi.length >= 3) return c.multi.slice();

  const t = c.topic.toLowerCase();
  if (!(t.includes('framework') || t.includes('core k8s objects'))) return null;
  const names: string[] = [];
  for (const it of c.items ?? []) {
    // "Kubernetes — the orchestrator (v1.30)" → "Kubernetes"
    const name = it.split(' — ')[0].split(' (')[0].trim();
    if (name) names.push(name);
  }
  return names.length >= 3 ? names : null;
}

const MASK_STOP = new Set(
  'the a an of to vs and or in on for with your you it its via how what why not is are be as at by no into per own over off out up so any this that when then than'.split(
    ' ',
  ),
);

/** Words from the topic to blank out in the masked answer (length rule + acronyms). */
export function topicWords(topic: string): string[] {
  const cleaned = topic.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  const words = cleaned.split(' ').filter((w) => w.length >= 4 && !MASK_STOP.has(w));
  for (const tok of topic.match(/[A-Z][A-Z0-9]{1,}/g) ?? []) words.push(tok.toLowerCase());
  // sorted(set(words), key=len, reverse=True) — longest first, deduped.
  return [...new Set(words)].sort((a, b) => b.length - a.length);
}

/** Replace each masked word (and its \w* suffix) with 3–7 ▁ characters. */
export function maskText(text: string, words: string[]): string {
  let out = text;
  for (const w of words) {
    const re = new RegExp(`\\b${escapeRegExp(w)}\\w*`, 'gi');
    out = out.replace(re, (m) => '▁'.repeat(Math.min(7, Math.max(3, m.length))));
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The answer with the topic's own words blanked — for 'identify' mode. */
export function backMasked(c: RawCard, diagrams: Record<string, string>): string {
  const words = topicWords(c.topic);
  if (!words.length) return backBody(c, diagrams);
  const mc: RawCard = {
    ...c,
    desc: maskText(c.desc, words),
    items: (c.items ?? []).map((it) => maskText(it, words)),
    order: c.order ? c.order.map((it) => maskText(it, words)) : undefined,
    extras: (c.extras ?? []).map((e) => ({ label: e.label, text: maskText(e.text, words) })),
  };
  if (c.table) {
    mc.table = [c.table[0], ...c.table.slice(1).map((r) => r.map((cell) => maskText(cell, words)))];
  }
  return backBody(mc, diagrams, c.fold);
}

/** Build one game-ready card from a raw (authored + id/cat) card — mirrors the Python comprehension. */
export function toGameCard(c: RawCard, diagrams: Record<string, string>): GameCard {
  const recall = Boolean(c.recall);
  return {
    id: c.id,
    cat: c.cat,
    topic: c.topic,
    back: backBody(c, diagrams, c.fold),
    printBack: backBody(c, diagrams), // never folded — the print sheet always expands extras
    backMasked: backMasked(c, diagrams),
    cloze: recall ? null : clozeObj(c),
    chars: chars(c),
    hint: hint(c),
    match: recall ? null : match(c),
    multi: recall ? null : multi(c),
    mc: c.mc ?? null,
    recall,
    inverse: Boolean(c.inverse) && !recall,
    fill: recall ? null : (c.fill ?? null),
    categorize: recall ? null : (c.categorize ?? null),
    order: recall ? null : (c.order ?? null),
    code: codeLines(c),
    codeselect: recall ? null : (c.codeselect ?? null),
  };
}

// Pure port of the Python generator's card transforms (gen_flashcards.py).
// Each function mirrors its Python counterpart 1:1 so the produced game payload is
// byte-identical to the original. Kept free of I/O so it can be unit-tested directly.
import type { AuthoredCard, GameCard, Manifest } from './card-schema.js';

/** An authored card plus the fields the transforms need (id, cat). */
export interface RawCard extends AuthoredCard {
  id: string;
  cat: string;
  desc: string; // required once loaded (schema fills empty string if omitted)
}

/** Python's html.escape(s, quote=True): & < > " ' — in that order. */
// Escapes the same five characters Python's html.escape() does. One pass over the string, not five —
// and, more to the point, the ordering hazard disappears: chaining .replace() calls only worked
// because `&` was escaped first, and a future edit that moved it would have double-escaped the rest.
// A single character class cannot be got wrong that way.
const ESC_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

/**
 * The answer content (desc + items + table + extras + diagram), no id corner.
 * `fold=true` tucks extras/diagram behind a collapsible <details> (game only).
 */
export function backBody(c: RawCard, diagrams: Record<string, string>, fold = false): string {
  const parts: string[] = [`<div class="desc">${esc(c.desc)}</div>`];
  if (c.items && c.items.length) {
    const lis = c.items.map((it) => `<li>${esc(it)}</li>`).join('');
    parts.push(`<ul class="items">${lis}</ul>`);
  }
  if (c.table && c.table.length) {
    const rows = c.table;
    const head = rows[0].map((h) => `<th>${esc(h)}</th>`).join('');
    const body = rows
      .slice(1)
      .map((r) => '<tr>' + r.map((cell) => `<td>${esc(cell)}</td>`).join('') + '</tr>')
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
    parts.push(
      '<details class="foldmore"><summary>More detail</summary>' + extraParts.join('') + '</details>',
    );
  } else {
    parts.push(...extraParts);
  }
  return parts.join('');
}

/** cloze object {pre,post,answer,alts} from an authored {text,answer,alts?}. */
export function clozeObj(
  c: RawCard,
): { pre: string; post: string; answer: string; alts: string[] } | null {
  const t = c.cloze;
  if (!t) return null;
  const parts = t.text.split('{}');
  return { pre: parts[0], post: parts.length > 1 ? parts[1] : '', answer: t.answer, alts: t.alts ?? [] };
}

/** Total textual content length — drives the content-aware timer. */
export function chars(c: RawCard): number {
  let n = c.topic.length + c.desc.length;
  for (const it of c.items ?? []) n += it.length;
  for (const { label, text } of c.extras ?? []) n += label.length + text.length;
  for (const row of c.table ?? []) for (const cell of row) n += cell.length;
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
  return cut + '…';
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
 * Multi-select member names: an explicit `multi:` list, or — for the older cards that predate the
 * field — inferred from a list card's `items`.
 *
 * The explicit branch is the one that was missing. `multi:` has always been in the schema and the
 * author docs ("Explicit multi-select member names"), but this function only ever looked at `items`,
 * and then only when the TOPIC happened to contain the word "framework" or "core k8s objects". So a
 * card that authored a perfectly good `multi:` list silently got no select-all mode, and the feature
 * worked purely by accident of how a topic was named. Every other authorable field (match, cloze,
 * manifest, mc) is honoured when given; this one was not.
 *
 * The inference is kept, because ten cards across three sections rely on it today.
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
    const re = new RegExp('\\b' + escapeRegExp(w) + '\\w*', 'gi');
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
    manifest: recall ? null : (c.manifest ?? null),
  };
}

export type { Manifest };

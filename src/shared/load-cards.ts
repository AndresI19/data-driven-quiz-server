// Reads cards/*.yaml (one file per section) + cards/_diagrams.yaml, validates each with
// zod, assigns per-section IDs, runs the transforms, and returns the game-ready payload.
// Used by BOTH the Vite dev middleware and the Express server — one data pipeline.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { CardsPayload, GameCard } from './card-schema.js';
import { type RawCard, toGameCard } from './card-transform.js';

const ExtraSchema = z.object({ label: z.string(), text: z.string() }).strict();
const ClozeSchema = z
  .object({ text: z.string(), answer: z.string(), alts: z.array(z.string()).optional() })
  .strict();
const ManifestSchema = z
  .object({
    lines: z.array(z.string()),
    blanks: z.array(z.string()),
    distractors: z.array(z.string()).optional(),
  })
  .strict();

const AuthoredCardSchema = z
  .object({
    topic: z.string(),
    desc: z.string().optional(),
    extras: z.array(ExtraSchema).optional(),
    items: z.array(z.string()).optional(),
    table: z.array(z.array(z.string())).optional(),
    diagram: z.string().optional(),
    match: z.array(z.tuple([z.string(), z.string()])).optional(),
    multi: z.array(z.string()).optional(),
    mc: z.array(z.string()).optional(),
    cloze: ClozeSchema.optional(),
    hint: z.string().optional(),
    fold: z.boolean().optional(),
    recall: z.boolean().optional(),
    inverse: z.boolean().optional(),
    manifest: ManifestSchema.optional(),
  })
  .strict();

const SectionSchema = z.object({ key: z.string(), name: z.string(), color: z.string() }).strict();
const SectionFileSchema = z.object({ section: SectionSchema, cards: z.array(AuthoredCardSchema) }).strict();

const DiagramsSchema = z.record(z.string(), z.string());

/** A validated section file plus its source filename (for stable ordering + errors). */
interface LoadedSection {
  file: string;
  section: z.infer<typeof SectionSchema>;
  cards: z.infer<typeof AuthoredCardSchema>[];
}

function fail(file: string, err: z.ZodError): never {
  const first = err.issues[0];
  const where = first?.path.length ? ` at ${first.path.join('.')}` : '';
  throw new Error(`Invalid card file "${file}"${where}: ${first?.message ?? 'schema error'}`);
}

function readDiagrams(dir: string): Record<string, string> {
  const p = resolve(dir, '_diagrams.yaml');
  if (!existsSync(p)) return {};
  const parsed = DiagramsSchema.safeParse(yaml.load(readFileSync(p, 'utf8')) ?? {});
  if (!parsed.success) fail('_diagrams.yaml', parsed.error);
  return parsed.data;
}

/** Read + validate every section file (excludes files beginning with "_"), in filename order. */
function readSections(dir: string): LoadedSection[] {
  const files = readdirSync(dir)
    .filter((f) => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.startsWith('_'))
    .sort(); // a-*.yaml, b-*.yaml, … → sections A, B, … in the original order
  const out: LoadedSection[] = [];
  for (const file of files) {
    const parsed = SectionFileSchema.safeParse(yaml.load(readFileSync(join(dir, file), 'utf8')));
    if (!parsed.success) fail(file, parsed.error);
    out.push({ file, section: parsed.data.section, cards: parsed.data.cards });
  }
  return out;
}

/** Load, validate, transform. Returns the exact payload the client consumes at boot. */
export function loadCardsPayload(dir: string): CardsPayload {
  const diagrams = readDiagrams(dir);
  const sections = readSections(dir);

  const cats: Record<string, string> = {};
  const catColors: Record<string, string> = {};
  const cards: GameCard[] = [];
  const multiPool: Record<string, string[]> = {};

  for (const { section, cards: authored } of sections) {
    cats[section.key] = section.name;
    catColors[section.key] = section.color;
    authored.forEach((a, i) => {
      const raw: RawCard = { ...a, id: `${section.key}${i + 1}`, cat: section.key, desc: a.desc ?? '' };
      const gc = toGameCard(raw, diagrams);
      cards.push(gc);
      if (gc.multi) multiPool[gc.id] = gc.multi;
    });
  }

  return { cats, catColors, cards, diagrams, multiPool };
}

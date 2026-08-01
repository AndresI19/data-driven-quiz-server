// Reads cards/*.yaml (one file per section) + cards/_diagrams.yaml, validates each with
// zod, assigns per-section IDs, runs the transforms, and returns the game-ready payload.
// Used by BOTH the Vite dev middleware and the Express server — one data pipeline.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { CardsPayload, GameCard, Group } from './card-schema.js';
import { type RawCard, toGameCard } from './card-transform.js';

const ExtraSchema = z.object({ label: z.string(), text: z.string() }).strict();
const ClozeSchema = z
  .object({ text: z.string(), answer: z.string(), alts: z.array(z.string()).optional() })
  .strict();
const FillSchema = z
  .object({
    text: z.string(),
    blanks: z.array(z.string()),
    distractors: z.array(z.string()).optional(),
    code: z.boolean().optional(),
  })
  .strict();
const CategorizeSchema = z
  .object({
    columns: z.array(z.object({ header: z.string(), items: z.array(z.string()).min(1) }).strict()).min(2),
  })
  .strict();
const CodeSchema = z.object({ lang: z.string().optional(), text: z.string() }).strict();
// A self-contained multiple-choice question: prompt + authored options + the index of the right one.
const McqSchema = z
  .object({
    prompt: z.string(),
    options: z.array(z.string()).min(2),
    answerIndex: z.number().int().nonnegative(),
  })
  .strict()
  .refine((m) => m.answerIndex < m.options.length, { message: 'answerIndex out of range' });
const CodeSelectSchema = z
  .object({ prompt: z.string(), answer: z.array(z.number().int().nonnegative()) })
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
    mcq: McqSchema.optional(),
    cloze: ClozeSchema.optional(),
    hint: z.string().optional(),
    fold: z.boolean().optional(),
    recall: z.boolean().optional(),
    inverse: z.boolean().optional(),
    fill: FillSchema.optional(),
    categorize: CategorizeSchema.optional(),
    order: z.array(z.string()).min(2).optional(),
    code: CodeSchema.optional(),
    codeselect: CodeSelectSchema.optional(),
  })
  .strict();

const SectionSchema = z.object({ key: z.string(), name: z.string(), color: z.string() }).strict();
const SectionFileSchema = z.object({ section: SectionSchema, cards: z.array(AuthoredCardSchema) }).strict();

const DiagramsSchema = z.record(z.string(), z.string());

const GroupSchema = z
  .object({ key: z.string(), name: z.string(), color: z.string(), sections: z.array(z.string()).min(1) })
  .strict();
const GroupsFileSchema = z.object({ groups: z.array(GroupSchema) }).strict();

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

/**
 * Read + validate cards/_groups.yaml (the role buckets). Returns [] when absent (backward
 * compatible). Every referenced section key must exist and belong to at most one group — a typo
 * would otherwise silently drop a section from the UI, so it is a hard error, like a bad card.
 */
function readGroups(dir: string, sectionKeys: Set<string>): Group[] {
  const p = resolve(dir, '_groups.yaml');
  if (!existsSync(p)) return [];
  const parsed = GroupsFileSchema.safeParse(yaml.load(readFileSync(p, 'utf8')) ?? {});
  if (!parsed.success) fail('_groups.yaml', parsed.error);
  const seen = new Set<string>();
  for (const g of parsed.data.groups) {
    for (const k of g.sections) {
      if (!sectionKeys.has(k))
        throw new Error(
          `Invalid card file "_groups.yaml": group "${g.key}" references unknown section "${k}"`,
        );
      if (seen.has(k))
        throw new Error(`Invalid card file "_groups.yaml": section "${k}" appears in more than one group`);
      seen.add(k);
    }
  }
  return parsed.data.groups;
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

  const groups: Group[] = readGroups(dir, new Set(sections.map((s) => s.section.key)));

  return { cats, catColors, groups, cards, diagrams, multiPool };
}

// Authored card shape (what you write in cards/*.yaml) and the game-ready shape the
// client consumes. Kept 1:1 with the original Python generator's fields.

export interface Extra {
  label: string;
  text: string;
}

export interface Cloze {
  text: string; // sentence containing a single "{}" placeholder
  answer: string;
  alts?: string[];
}

export interface Fill {
  text: string; // passage with {0}, {1}, … placeholders; newlines allowed (rendered as lines when code)
  blanks: string[]; // correct label for each placeholder, in order
  distractors?: string[];
  code?: boolean; // render the passage as a monospace code block — a YAML card is just fill + code: true
}

export interface CatColumn {
  header: string; // the category label
  items: string[]; // the pool items that correctly belong under it
}
export interface Categorize {
  columns: CatColumn[]; // ≥2 categories; the pool is the union of all items — no dummies
}

/** Authored form: the block is a single literal string (YAML `text: |`), split into lines on load. */
export interface CodeSource {
  lang?: string; // display hint only (dockerfile, yaml, ts, sql, bash, …)
  text: string; // the whole block, newlines and all
}

/** Game form: the block already split into lines (what codeselect.answer indexes into). */
export interface Code {
  lang?: string;
  lines: string[];
}

export interface CodeSelect {
  prompt: string; // "select the lines that install the binary"
  answer: number[]; // 0-based indices into Code.lines that are correct
}

/** A self-contained multiple-choice question: a scenario prompt with authored options and one right
 *  answer. Unlike `mc` (extra distractor topics for the identify grid), `mcq` carries its OWN prompt
 *  and options → the "multiple-choice" mode (mq). Adopted from the Know Your Stack fork's mobile bank. */
export interface Mcq {
  prompt: string;
  options: string[];
  answerIndex: number; // 0-based index of the correct option
}

/** A card exactly as authored in YAML (before transforms). */
export interface AuthoredCard {
  /** Cross-cutting tags, validated against cards/_labels.yaml. Unlike `cat` (the lettered
   *  section, exactly one per card) a card may carry SEVERAL labels, and a label spans sections —
   *  which is the point: section A holds both "sharding" (system-design) and "TLS handshake"
   *  (fundamentals). Optional; a card with none simply carries no tags. */
  labels?: string[];
  topic: string;
  desc?: string;
  extras?: Extra[];
  items?: string[];
  table?: string[][];
  diagram?: string; // key into the diagrams registry
  match?: [string, string][];
  multi?: string[];
  mc?: string[];
  mcq?: Mcq; // a self-contained multiple-choice question → enables "multiple-choice" (mq)
  cloze?: Cloze;
  hint?: string;
  fold?: boolean;
  recall?: boolean;
  inverse?: boolean;
  fill?: Fill; // drag labels into a passage's blanks (prose, or a code block when code: true) → (fl)
  categorize?: Categorize; // sort a pool of items into category columns → "categorize" (cg)
  order?: string[]; // steps in their CORRECT sequence → enables "put in order" (or)
  code?: CodeSource; // a code block → enables "what is this doing?" (cw)
  codeselect?: CodeSelect; // + a block → enables "select the lines" (cs)
}

/** Game-ready card the client renders (mirrors the Python `game_cards` objects). */
export interface GameCard {
  id: string;
  cat: string;
  labels: string[]; // [] when the card carries none
  topic: string;
  back: string; // rendered answer HTML (game: extras/diagram folded when the card sets fold)
  printBack: string; // rendered answer HTML for the print sheet — always expanded (never folded)
  backMasked: string; // answer HTML with the topic's own words blanked
  cloze: { pre: string; post: string; answer: string; alts: string[] } | null;
  chars: number;
  hint: string;
  match: [string, string][] | null;
  multi: string[] | null;
  mc: string[] | null;
  mcq: Mcq | null;
  recall: boolean;
  inverse: boolean;
  fill: Fill | null;
  categorize: Categorize | null;
  order: string[] | null; // correct step sequence, or null when the card has none
  code: Code | null;
  codeselect: CodeSelect | null;
}

/** A cross-cutting tag a card may carry. Sections partition the deck; labels cut across it, so a
 *  card can hold several and any label can appear in any section. Declared in cards/_labels.yaml. */
export interface Label {
  key: string; // stable id used on cards (e.g. "system-design")
  name: string; // display label
  color: string; // hex accent
  desc: string; // what belongs under it — the authoring rule, not marketing copy
}

/** A job-role bucket folding several sections together — a presentation layer over section keys. */
export interface Group {
  key: string; // stable group id (e.g. "platform")
  name: string; // display label
  color: string; // hex accent
  sections: string[]; // section keys it contains, in display order
}

/** Everything the client needs at boot. */
export interface CardsPayload {
  cats: Record<string, string>; // key → section name
  catColors: Record<string, string>; // key → hex
  labels: Label[]; // the label vocabulary; [] when cards/_labels.yaml is absent
  groups: Group[]; // role buckets over the sections; [] when cards/_groups.yaml is absent
  cards: GameCard[];
  diagrams: Record<string, string>; // name → inline SVG
  multiPool: Record<string, string[]>; // card id → multi member names (distractor pool)
}

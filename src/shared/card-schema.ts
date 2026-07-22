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

/** A card exactly as authored in YAML (before transforms). */
export interface AuthoredCard {
  topic: string;
  desc?: string;
  extras?: Extra[];
  items?: string[];
  table?: string[][];
  diagram?: string; // key into the diagrams registry
  match?: [string, string][];
  multi?: string[];
  mc?: string[];
  cloze?: Cloze;
  hint?: string;
  fold?: boolean;
  recall?: boolean;
  inverse?: boolean;
  fill?: Fill; // drag labels into a passage's blanks (prose, or a code block when code: true) → (fl)
  order?: string[]; // steps in their CORRECT sequence → enables "put in order" (or)
  code?: CodeSource; // a code block → enables "what is this doing?" (cw)
  codeselect?: CodeSelect; // + a block → enables "select the lines" (cs)
}

/** Game-ready card the client renders (mirrors the Python `game_cards` objects). */
export interface GameCard {
  id: string;
  cat: string;
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
  recall: boolean;
  inverse: boolean;
  fill: Fill | null;
  order: string[] | null; // correct step sequence, or null when the card has none
  code: Code | null;
  codeselect: CodeSelect | null;
}

/** Everything the client needs at boot. */
export interface CardsPayload {
  cats: Record<string, string>; // key → section name
  catColors: Record<string, string>; // key → hex
  cards: GameCard[];
  diagrams: Record<string, string>; // name → inline SVG
  multiPool: Record<string, string[]>; // card id → multi member names (distractor pool)
}

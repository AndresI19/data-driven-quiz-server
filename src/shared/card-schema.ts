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

export interface Manifest {
  lines: string[]; // lines containing {0}, {1}, … placeholders
  blanks: string[]; // correct label for each placeholder, in order
  distractors?: string[];
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
  manifest?: Manifest;
}

export interface Section {
  key: string; // A..Z, the ID prefix
  name: string;
  color: string; // hex, drives the per-section accent
}

export interface SectionFile {
  section: Section;
  cards: AuthoredCard[];
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
  manifest: Manifest | null;
}

/** Everything the client needs at boot. */
export interface CardsPayload {
  cats: Record<string, string>; // key → section name
  catColors: Record<string, string>; // key → hex
  cards: GameCard[];
  diagrams: Record<string, string>; // name → inline SVG
  multiPool: Record<string, string[]>; // card id → multi member names (distractor pool)
}

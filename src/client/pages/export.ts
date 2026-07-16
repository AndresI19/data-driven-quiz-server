import { isAdmin } from '@platform/ui/auth';
import { setScreenBg } from '../garden/screenbg.js';
import { dismissTransients } from '../quiz/pause.js';
import { stopTicker } from '../quiz/timer.js';
// Export page: a shareable digest of flagged + noted cards, plus a full-save JSON download.
// For an admin it also emits the flag audit — see buildAudit below.
import { CATS, app, byId } from '../runtime/data.js';
import { DB } from '../runtime/db.js';
import { S } from '../runtime/state.js';
import { setKey } from '../runtime/util.js';
import { setup } from './home.js';

/** One flagged card, paired with whatever note explains why it was flagged. */
interface AuditEntry {
  id: string;
  deck: string;
  section: string;
  /** Which card in the deck, counting from 1 — the number the id encodes. */
  position: number;
  topic: string;
  /** The reason to act on. A flag with no note carries no instruction, so it stays null. */
  note: string | null;
}

/* The flag audit: the machine-readable half of this page, for pasting into a Claude session that
   will edit the decks.

   JSON rather than the prose digest below it, because this is read by a tool and the digest is read
   by a person — the digest's job is to be skimmed, this one's is to be unambiguous about WHICH card
   is meant. Hence `deck` + `position` alongside `id`: card ids are positional (load-cards.ts assigns
   `${section.key}${i + 1}` by array index and stores nothing in the YAML), so "A7" only means
   anything as "the 7th card of cards/a-*.yaml". Spelling that out is what lets the reader find the
   card without re-deriving the id scheme — and it is a standing warning that editing a card in place
   is safe while inserting, deleting or reordering silently repoints every flag after it. */
export function buildAudit(flagged: string[], notes: Record<string, string>): string {
  const entries: AuditEntry[] = flagged.map((id) => ({
    id,
    deck: byId[id].cat,
    section: CATS[byId[id].cat] ?? byId[id].cat,
    position: Number(id.slice(byId[id].cat.length)),
    topic: byId[id].topic,
    note: notes[id]?.trim() || null,
  }));
  return JSON.stringify({ flagged: entries.length, cards: entries }, null, 2);
}

export function exportPage(): void {
  stopTicker();
  S.running = false;
  dismissTransients();
  setScreenBg(false);
  // latest note per card across every session (+ any in-progress one)
  const notes: Record<string, string> = {};
  (DB.sessions || [])
    .slice()
    .reverse()
    .forEach((s) => {
      const n = s.notes || {};
      for (const id in n) {
        if ((n[id] || '').trim()) notes[id] = n[id];
      }
    });
  if (DB.active?.notes) {
    const n = DB.active.notes;
    for (const id in n) {
      if ((n[id] || '').trim()) notes[id] = n[id];
    }
  }
  const ids = Object.keys(notes).filter((id) => byId[id]);
  const flagged = Object.keys(DB.flags).filter((id) => byId[id]);
  const noteBlock = ids.length
    ? ids
        .map(
          (id) =>
            `${DB.flags[id] ? '⚑ ' : ''}[${id}] ${byId[id].topic}\n    ${notes[id].replace(/\n/g, '\n    ')}`,
        )
        .join('\n\n')
    : '(no notes recorded yet)';
  const flagBlock = flagged.length
    ? `⚑ FLAGGED FOR REVIEW (${flagged.length}):\n${flagged.map((id) => `  [${id}] ${byId[id].topic}${notes[id] ? '' : ' — (no note)'}`).join('\n')}\n\n`
    : '';
  const digest = flagBlock + noteBlock;
  // Only an admin can flag (quiz/engine.ts), so only an admin has an audit to export. A player who
  // flagged cards before that gate existed still holds those flags in their document; this keeps the
  // panel off their page rather than handing them a tool with nothing to do.
  const audit = isAdmin() && flagged.length ? buildAudit(flagged, notes) : '';
  const auditPanel = audit
    ? `<div class="panel">
      <div class="lab">⚑ Flag audit (${flagged.length}) — structured, for pasting into Claude</div>
      <textarea class="noteta" id="exaudit" style="min-height:220px" readonly></textarea>
      <div class="tiny" style="margin-top:8px">Every flagged card with its note. A card flagged without a note exports <code>"note": null</code> — the flag says something is wrong, the note is what says what.</div>
    </div>`
    : '';
  app.innerHTML = `<div class="wrap">
    <div class="rvbar">
      <button class="btn ghost sm" id="exback">← Home</button>
      <div class="lab" style="margin:0">Export notes</div>
      <span></span>
    </div>
    ${auditPanel}
    <div class="panel">
      <div class="lab">Card notes (${ids.length}) — select all &amp; copy to share for edits</div>
      <textarea class="noteta" id="exnotes" style="min-height:320px" readonly></textarea>
      <div class="tiny" style="margin-top:8px">Click the box, Ctrl+A, Ctrl+C. The full save file (JSON backup) is in the 🪲 debug menu, bottom-right.</div>
    </div>
  </div>`;
  const ta = app.querySelector('#exnotes') as HTMLTextAreaElement;
  ta.value = digest;
  const at = app.querySelector('#exaudit') as HTMLTextAreaElement | null;
  if (at) {
    at.value = audit;
    at.addEventListener('focus', () => at.select());
  }
  app.querySelector('#exback')!.addEventListener('click', setup);
  ta.addEventListener('focus', () => ta.select());
  setKey((e) => {
    if (e.key === 'Escape') setup();
  });
}

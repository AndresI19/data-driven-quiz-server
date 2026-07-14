import { setScreenBg } from '../garden/screenbg.js';
import { hidePause } from '../quiz/pause.js';
import { stopTicker } from '../quiz/timer.js';
// Export page: a shareable digest of flagged + noted cards, plus a full-save JSON download. Verbatim.
import { app, byId } from '../runtime/data.js';
import { DB } from '../runtime/db.js';
import { S } from '../runtime/state.js';
import { setKey } from '../runtime/util.js';
import { setup } from './home.js';

export function exportPage(): void {
  stopTicker();
  S.running = false;
  hidePause();
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
  app.innerHTML = `<div class="wrap">
    <div class="rvbar">
      <button class="btn ghost sm" id="exback">← Home</button>
      <div class="lab" style="margin:0">Export notes</div>
      <span></span>
    </div>
    <div class="panel">
      <div class="lab">Card notes (${ids.length}) — select all &amp; copy to share for edits</div>
      <textarea class="noteta" id="exnotes" style="min-height:320px" readonly></textarea>
      <div class="tiny" style="margin-top:8px">Click the box, Ctrl+A, Ctrl+C. The full save file (JSON backup) is in the 🪲 debug menu, bottom-right.</div>
    </div>
  </div>`;
  const ta = app.querySelector('#exnotes') as HTMLTextAreaElement;
  ta.value = digest;
  app.querySelector('#exback')!.addEventListener('click', setup);
  ta.addEventListener('focus', () => ta.select());
  setKey((e) => {
    if (e.key === 'Escape') setup();
  });
}

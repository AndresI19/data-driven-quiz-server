// Welcome-coin grants: a one-time award for creating an account (and, deferred, for sharing a
// LinkedIn/company), delivered via a "mail" button on the garden. The grant STATE lives on the synced
// document (DB.grant) so claiming on one browser clears the marker on every other. Owns the state
// machine and claim UI; does NOT import garden/page.ts (the garden imports THIS), so after a claim it
// touches the DOM directly rather than re-rendering.
import { isGuest, isSignedIn } from '@platform/ui/auth';
import { COIN, CURRENCY } from '../runtime/currency.js';
import { DB, saveDB } from '../runtime/db.js';

/** Coins awarded for having a login. */
export const LOGIN_GRANT = 200;
/** Coins awarded for sharing a LinkedIn/company. Deferred — nothing sets `contact` to 'pending' yet. */
export const CONTACT_GRANT = 200;

/**
 * Promote the login grant to 'pending' the first time we see a signed-in (non-guest) account —
 * existing holders pick it up next load (an intended one-time rollout). Idempotent, and MUST run AFTER
 * pull() adopts the server document so a 'claimed' state is not reset to 'pending'. Guests never earn it.
 */
export function ensureLoginGrant(): void {
  if (isSignedIn() && DB.grant.login === 'none') {
    DB.grant.login = 'pending';
    saveDB();
  }
}

/** Total coins waiting to be claimed right now. */
export function claimableAmount(): number {
  return (
    (DB.grant.login === 'pending' ? LOGIN_GRANT : 0) + (DB.grant.contact === 'pending' ? CONTACT_GRANT : 0)
  );
}

/** Whether the garden mail marker should show. */
export function hasUnclaimed(): boolean {
  return claimableAmount() > 0;
}

/**
 * Collect every pending grant: bank the coins, flip pending→claimed, persist, then refresh the balance
 * and drop the marker in place. The amount<=0 guard makes a second call a no-op, stopping a rapid
 * double-click (or stale re-entrant handler) from awarding twice.
 */
export function claimGrants(): void {
  const amount = claimableAmount();
  if (amount <= 0) return;
  DB.coins += amount;
  if (DB.grant.login === 'pending') DB.grant.login = 'claimed';
  if (DB.grant.contact === 'pending') DB.grant.contact = 'claimed';
  saveDB();

  // Refresh the top-bar balance in place (a full re-render would rebuild the board and interrupt the
  // fade). Anchor the claim message at the mail icon, then remove the row — once claimed the icon no
  // longer renders (see mailButtonHtml).
  const bal = document.querySelector('.coinbal');
  // innerHTML, not textContent: COIN is an inline SVG now. The interpolated value is a number or ∞,
  // never user input, so there is nothing to escape.
  if (bal) bal.innerHTML = `${COIN} ${DB.infinite ? '∞' : DB.coins}`;
  const rect = document.getElementById('gmail')?.getBoundingClientRect();
  document.querySelector('.gmailrow')?.remove();

  showGrantClaim(amount, rect);
}

/** The claim feedback: a small "Thanks…" + "+N", faded in then out, anchored at the mail icon's spot
 *  (falls back to a fixed corner if the icon's position could not be read). No dialog, no dismiss. */
function showGrantClaim(amount: number, at?: DOMRect): void {
  document.querySelector('.grantclaim')?.remove();
  const el = document.createElement('div');
  el.className = 'grantclaim';
  el.innerHTML = `<div class="gc-msg">Thanks for creating a login</div><div class="gc-amt">+${amount} ${COIN}</div>`;
  el.style.left = `${Math.round(at?.left ?? 16)}px`;
  el.style.top = `${Math.round(at?.top ?? 96)}px`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('go'), 20); // fade in
  setTimeout(() => el.classList.remove('go'), 1800); // hold, then fade out (CSS transition)
  setTimeout(() => el.remove(), 2400); // remove after the fade-out completes
}

/** The welcome-coin mail button, wrapped in its own row for placement below the toolbar. Rendered
 *  ONLY when a signed-in player has something to claim — once claimed (or for a guest) it is absent
 *  entirely, not a dead icon. */
export function mailButtonHtml(): string {
  if (!isSignedIn() || !hasUnclaimed()) return '';
  return `<div class="gmailrow"><button class="gmail" id="gmail" type="button" title="Claim your welcome coins" aria-label="Claim your welcome coins">✉️<span class="gmail-dot" aria-hidden="true"></span></button></div>`;
}

/** Guest-only watermark under the login FAB, inviting them to create an account to claim coins. */
export function guestWatermarkHtml(): string {
  if (!isGuest()) return '';
  // Range derived from the grant consts so the pitch can't drift from what's actually paid: the login
  // grant alone at the low end, both grants together at the high end.
  const low = LOGIN_GRANT;
  const high = LOGIN_GRANT + CONTACT_GRANT;
  return `<div class="guestmark">Create a user to claim ${low}–${high} free ${CURRENCY.many}</div>`;
}

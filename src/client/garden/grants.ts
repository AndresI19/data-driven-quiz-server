// Welcome-coin grants: a one-time award for creating an account (and, deferred, for sharing a
// LinkedIn/company), delivered through a "mail" button on the garden page. The grant STATE lives on
// the synced document (DB.grant, see runtime/db.ts) so claiming on one browser clears the marker on
// every other; this module owns the small state machine and the claim UI. It deliberately does NOT
// import garden/page.ts — the garden imports THIS — so after a claim it refreshes the balance readout
// and drops the marker by touching the DOM directly rather than re-rendering the page.
import { isGuest, isSignedIn } from '@platform/ui/auth';
import { COIN, CURRENCY } from '../runtime/currency.js';
import { DB, saveDB } from '../runtime/db.js';

/** Coins awarded for having a login. */
export const LOGIN_GRANT = 200;
/** Coins awarded for sharing a LinkedIn/company. Deferred — nothing sets `contact` to 'pending' yet. */
export const CONTACT_GRANT = 200;

/**
 * Promote the login grant to 'pending' the first time we see a signed-in (non-guest) account. Existing
 * account-holders pick it up on their next load — an intended one-time welcome rollout. Idempotent, and
 * MUST run AFTER pull() adopts the server document, so a document that already reads 'claimed' is not
 * reset to 'pending'. Guests never earn it (they cannot hold synced coins).
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
 * Collect every pending grant: bank the coins, flip pending→claimed, persist, then refresh the garden
 * balance and drop the marker in place. A second call is a no-op — the guard is what stops a rapid
 * double-click (or a stale re-entrant handler) from awarding the coins twice.
 */
export function claimGrants(): void {
  const amount = claimableAmount();
  if (amount <= 0) return;
  DB.coins += amount;
  if (DB.grant.login === 'pending') DB.grant.login = 'claimed';
  if (DB.grant.contact === 'pending') DB.grant.contact = 'claimed';
  saveDB();

  // Refresh the top-bar balance and remove the marker without a full page re-render (which would
  // rebuild the board and interrupt the fade message below).
  const bal = document.querySelector('.coinbal');
  if (bal) bal.textContent = `${COIN} ${DB.infinite ? '∞' : DB.coins}`;
  document.querySelector('.gmail-dot')?.remove();

  showGrantClaim(amount);
}

/** The claim feedback: "Thanks…" then a big "+N", faded in and then out. No dialog, no dismiss. */
function showGrantClaim(amount: number): void {
  document.querySelector('.grantclaim')?.remove();
  const el = document.createElement('div');
  el.className = 'grantclaim';
  el.innerHTML = `<div class="gc-msg">Thanks for creating a login</div><div class="gc-amt">+${amount} ${COIN}</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('go'), 20); // fade in
  setTimeout(() => el.classList.remove('go'), 2200); // hold, then fade out (CSS transition)
  setTimeout(() => el.remove(), 3000); // remove after the fade-out completes
}

/** Garden top-left mail button (signed-in only); the red dot shows only while something is unclaimed. */
export function mailButtonHtml(): string {
  if (!isSignedIn()) return '';
  const unclaimed = hasUnclaimed();
  const label = unclaimed ? 'Claim your welcome coins' : 'Mail';
  const dot = unclaimed ? '<span class="gmail-dot" aria-hidden="true"></span>' : '';
  return `<button class="gmail" id="gmail" type="button" title="${label}" aria-label="${label}">✉️${dot}</button>`;
}

/** Guest-only watermark under the login FAB, inviting them to create an account to claim coins. */
export function guestWatermarkHtml(): string {
  if (!isGuest()) return '';
  return `<div class="guestmark">Create a user to claim 200–400 free ${CURRENCY.many}</div>`;
}

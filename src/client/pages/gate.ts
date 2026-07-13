// The gate: the first thing a new player sees, and the only place identity is ever chosen.
//
// Three doors, and they are presented as three doors — not as "sign in" with a grey "skip" underneath
// it. Playing as a guest is a legitimate way to use this, and the only thing owed to someone who
// chooses it is a straight answer about what happens to their data.

import { continueAsGuest, current, pull, signIn, signUp } from '../runtime/auth.js';
import { esc } from '../runtime/util.js';

const el = (): HTMLElement => document.getElementById('app')!;

/** Has the player already made a choice? If so the gate never appears again. */
export function needsGate(): boolean {
  return current() === null;
}

function shell(inner: string): string {
  return `<div class="gate-backdrop"><div class="gate">${inner}</div></div>`;
}

function chooseView(): string {
  return shell(`
    <h2>Before you start</h2>
    <p class="gate-sub">Your progress — the cards you have seen, your sessions, your garden — has to
       live somewhere.</p>

    <div class="gate-doors">
      <button class="gate-door primary" data-act="new">
        <span class="gate-door-t">Create an account</span>
        <span class="gate-door-d">Pick a username. You get a 7-character code to remember. Your
          progress follows you to any browser.</span>
      </button>

      <button class="gate-door" data-act="signin">
        <span class="gate-door-t">I have a code</span>
        <span class="gate-door-d">Sign back in with your username and code.</span>
      </button>

      <button class="gate-door" data-act="guest">
        <span class="gate-door-t">Play as a guest</span>
        <!-- The disclaimer is the offer, not a disclaimer under the offer. Someone choosing this
             deserves to know the consequence before they click, not after they have lost a garden. -->
        <span class="gate-door-d warn">Nothing is sent anywhere. Everything stays in <em>this
          browser</em> — clear your site data, or open the quiz somewhere else, and it is gone. There
          is no way to recover it, because there is nothing to recover it from.</span>
      </button>
    </div>
  `);
}

function newView(): string {
  return shell(`
    <h2>Pick a username</h2>
    <p class="gate-sub">It is public — it shows on the leaderboard. It is not a secret.</p>
    <label class="gate-label" for="gate-user">Username</label>
    <input id="gate-user" class="gate-input" autocomplete="off" autocapitalize="off"
           spellcheck="false" placeholder="3–20 characters: a–z, 0–9, _ and -">
    <p class="gate-err" data-err hidden></p>
    <div class="gate-actions">
      <button class="gate-btn ghost" data-act="back">Back</button>
      <button class="gate-btn primary" data-act="create">Create</button>
    </div>
  `);
}

function codeView(username: string, code: string): string {
  // The one and only time this code exists anywhere but the server's HMAC. If the player closes this
  // without reading it, it is gone — so the copy says exactly that, and the button says "I have
  // written it down" rather than "OK", because "OK" is what people click without reading.
  return shell(`
    <h2>Write this down</h2>
    <p class="gate-sub">You are <strong>${esc(username)}</strong>. This is your code.</p>
    <div class="gate-code" data-code>${esc(code)}</div>
    <p class="gate-warn">
      <strong>This is the only time you will ever see it.</strong> It is not stored anywhere we can
      read it, there is no email attached to this account, and there is no way to reset it. Lose the
      code and the account is gone — along with everything in it.
    </p>
    <div class="gate-actions">
      <button class="gate-btn ghost" data-act="copy">Copy</button>
      <button class="gate-btn primary" data-act="done">I have written it down</button>
    </div>
  `);
}

function signInView(): string {
  return shell(`
    <h2>Sign in</h2>
    <label class="gate-label" for="gate-user">Username</label>
    <input id="gate-user" class="gate-input" autocomplete="username" autocapitalize="off" spellcheck="false">
    <label class="gate-label" for="gate-code">Code</label>
    <input id="gate-code" class="gate-input mono" autocomplete="one-time-code" autocapitalize="characters"
           spellcheck="false" placeholder="4KP7R2M" maxlength="9">
    <p class="gate-err" data-err hidden></p>
    <div class="gate-actions">
      <button class="gate-btn ghost" data-act="back">Back</button>
      <button class="gate-btn primary" data-act="go">Sign in</button>
    </div>
  `);
}

/** Show the gate and resolve once the player has chosen. */
export function gate(onDone: () => void): void {
  const host = document.createElement('div');
  host.className = 'gate-host';
  document.body.appendChild(host);

  const close = (): void => {
    host.remove();
    onDone();
  };

  const err = (msg: string): void => {
    const p = host.querySelector<HTMLElement>('[data-err]');
    if (p) {
      p.textContent = msg;
      p.hidden = false;
    }
  };

  const render = (html: string): void => {
    host.innerHTML = html;
  };

  render(chooseView());

  host.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;

    if (act === 'back') return render(chooseView());
    if (act === 'signin') return render(signInView());
    if (act === 'new') return render(newView());

    if (act === 'guest') {
      continueAsGuest();
      return close();
    }

    if (act === 'create') {
      const name = host.querySelector<HTMLInputElement>('#gate-user')!.value;
      void (async () => {
        try {
          const { username, code } = await signUp(name);
          render(codeView(username, code));
        } catch (e2) {
          err(e2 instanceof Error ? e2.message : 'could not create the account');
        }
      })();
      return;
    }

    if (act === 'copy') {
      const code = host.querySelector<HTMLElement>('[data-code]')?.textContent ?? '';
      void navigator.clipboard?.writeText(code);
      return;
    }

    if (act === 'done') {
      // A brand-new account: the server has nothing, so this uploads whatever is already in the
      // browser. Someone who played as a guest for a month and then signed up keeps their garden.
      void pull().finally(close);
      return;
    }

    if (act === 'go') {
      const name = host.querySelector<HTMLInputElement>('#gate-user')!.value;
      const code = host.querySelector<HTMLInputElement>('#gate-code')!.value;
      void (async () => {
        try {
          await signIn(name, code);
          const outcome = await pull();
          if (outcome.kind === 'kept-both') {
            // Nothing was destroyed, and the player is told so. Silently overwriting a garden here
            // would be the single worst thing this app could do.
            alert(
              'You already had progress in this browser AND on this account.\n\n' +
                "The account's progress is now loaded. The progress that was in this browser has " +
                'been kept as a backup and is not lost.',
            );
          }
          close();
        } catch (e2) {
          err(e2 instanceof Error ? e2.message : 'could not sign in');
        }
      })();
    }
  });

  // Deliberately NOT dismissible by clicking away or pressing Escape. Every other dialog in this app
  // is; this one is a decision about where a year of play is going to live, and it should be made on
  // purpose. "Play as a guest" is right there for anyone who does not want to decide.
  void el();
}

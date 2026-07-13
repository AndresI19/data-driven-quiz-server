import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Express, Request, Response, NextFunction } from 'express';
import pg from 'pg';

/**
 * Server-side progress: the player's document, kept for them instead of only in their browser.
 *
 * ── The shape ───────────────────────────────────────────────────────────────────────────────────
 * ONE JSONB DOCUMENT PER PLAYER, stored verbatim. The quiz's data was never relational — it is a
 * garden of cells, a list of sessions each carrying its own notes map, a mid-quiz snapshot holding a
 * whole question queue, and a per-card statistics map. Modelling that into tables would be a great
 * deal of work to reproduce a document that already exists, followed by a great deal more to
 * reassemble it for a client that wants it back as one object.
 *
 * ── The promoted columns ────────────────────────────────────────────────────────────────────────
 * `coins`, `answered` and `correct` are DERIVED from the document by this server on every write, and
 * are never accepted from the client. That is not tidiness. If the client could send them, it could
 * send a document with 10 coins and a `coins` column claiming 10,000, and the leaderboard would be
 * forgeable by anyone holding a bearer token. Deriving them makes the two disagreeing structurally
 * impossible rather than merely unlikely.
 *
 * ── Guests ──────────────────────────────────────────────────────────────────────────────────────
 * A guest never reaches this file. No identity, no request, no row — their data stays in their
 * browser, and the UI says so plainly. Guest mode is not a degraded account; it is the absence of one.
 */

const AUTH_JWKS = process.env.AUTH_JWKS_URI ?? '';
const AUTH_ISSUER = process.env.AUTH_ISSUER ?? '';
const AUTH_AUDIENCE = process.env.AUTH_AUDIENCE ?? 'platform';
const DATABASE_URL = process.env.DATABASE_URL ?? '';

/** Progress is OPTIONAL. With no database configured the quiz still runs exactly as it always has —
 *  entirely in the browser — which is also what keeps `npm run dev` a single command. */
export const progressEnabled = Boolean(DATABASE_URL && AUTH_JWKS);

const pool = progressEnabled ? new pg.Pool({ connectionString: DATABASE_URL }) : null;
const jwkSet = progressEnabled ? createRemoteJWKSet(new URL(AUTH_JWKS)) : null;

export async function migrate(): Promise<void> {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS progress (
      sub         uuid PRIMARY KEY,
      -- Denormalised from the token, so a leaderboard can name people without asking the auth
      -- service on every row. It is the PUBLIC half of an identity and safe to hold here; the code
      -- and the sub are not, and are not here.
      username    text NOT NULL DEFAULT '',
      data        jsonb NOT NULL,
      coins       integer NOT NULL DEFAULT 0,
      answered    integer NOT NULL DEFAULT 0,
      correct     integer NOT NULL DEFAULT 0,
      version     integer NOT NULL DEFAULT 1,
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS progress_coins_idx ON progress (coins DESC);
  `);
  console.log('[quiz] progress table ready');
}

/** The projection. Every value here is read out of the document — none is taken on trust. */
function derive(data: unknown): { coins: number; answered: number; correct: number } {
  const d = (data ?? {}) as { coins?: unknown; stats?: Record<string, { seen?: number; missed?: number }> };
  const coins = typeof d.coins === 'number' && Number.isFinite(d.coins) ? Math.max(0, Math.trunc(d.coins)) : 0;

  let seen = 0;
  let missed = 0;
  for (const s of Object.values(d.stats ?? {})) {
    seen += typeof s?.seen === 'number' ? s.seen : 0;
    missed += typeof s?.missed === 'number' ? s.missed : 0;
  }
  return { coins, answered: seen, correct: Math.max(0, seen - missed) };
}

interface Authed extends Request {
  sub?: string;
  username?: string;
}

/** Bearer required. A token we cannot verify grants nothing — there is no anonymous progress. */
async function requireAuth(req: Authed, res: Response, next: NextFunction): Promise<void> {
  const bearer = /^Bearer (.+)$/i.exec(req.get('authorization') ?? '')?.[1];
  if (!bearer || !jwkSet) {
    res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'sign in to sync progress' });
    return;
  }
  try {
    const { payload } = await jwtVerify(bearer, jwkSet, {
      issuer: AUTH_ISSUER,
      audience: AUTH_AUDIENCE,
      // Pinned. Left open, a forged header could ask for `alg: none` and choose its own rules.
      algorithms: ['RS256'],
    });
    req.sub = String(payload.sub);
    req.username = typeof payload.username === 'string' ? payload.username : undefined;
    next();
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
}

export function mountProgress(app: Express, base: string): void {
  if (!pool) return;

  app.get(`${base}/api/progress`, requireAuth, async (req: Authed, res) => {
    const { rows } = await pool.query(
      'SELECT data, version, updated_at FROM progress WHERE sub = $1',
      [req.sub],
    );
    if (!rows[0]) {
      // Not an error: a brand-new player simply has nothing yet. The client then uploads whatever is
      // in its localStorage, which is the migration path — see PUT below.
      res.json({ data: null, version: 0 });
      return;
    }
    res.json({ data: rows[0].data, version: rows[0].version, updatedAt: rows[0].updated_at });
  });

  app.put(`${base}/api/progress`, requireAuth, async (req: Authed, res) => {
    const body = req.body as { data?: unknown; version?: unknown };
    if (body?.data === undefined || body.data === null || typeof body.data !== 'object') {
      res.status(400).json({ error: 'provide { data, version }' });
      return;
    }
    const clientVersion = typeof body.version === 'number' ? body.version : 0;
    const d = derive(body.data);

    /**
     * OPTIMISTIC CONCURRENCY, and it is here because last-write-wins DESTROYS GARDENS.
     *
     * One identity, two browsers. Someone plays on their phone, opens their laptop, and the laptop's
     * stale document silently overwrites an evening's progress — no error, nothing to roll back to.
     *
     * So the write only lands if the client is writing on top of the version it actually read. If it
     * is not, the server refuses and hands back what it has. What the client DOES with that (merge,
     * ask, refetch) is a UI decision. What the server must not do is throw data away without saying
     * so.
     *
     * `version = 0` means "I have never read from the server", which is only legitimate when no row
     * exists — the first upload after a sign-in. Once a row exists, a 0 is a stale client and is
     * rejected like any other mismatch.
     */
    const { rows } = await pool.query(
      `INSERT INTO progress (sub, username, data, coins, answered, correct, version, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, now())
       ON CONFLICT (sub) DO UPDATE
         SET username = EXCLUDED.username,
             data = EXCLUDED.data,
             coins = EXCLUDED.coins,
             answered = EXCLUDED.answered,
             correct = EXCLUDED.correct,
             version = progress.version + 1,
             updated_at = now()
         WHERE progress.version = $7
       RETURNING version`,
      [req.sub, req.username ?? '', body.data, d.coins, d.answered, d.correct, clientVersion],
    );

    if (!rows[0]) {
      // The WHERE on the DO UPDATE did not match: somebody else wrote since this client last read.
      const current = await pool.query('SELECT data, version FROM progress WHERE sub = $1', [req.sub]);
      res.status(409).json({
        error: 'stale version',
        detail: 'This account was updated somewhere else. Refetch and merge before writing.',
        version: current.rows[0]?.version ?? 0,
        data: current.rows[0]?.data ?? null,
      });
      return;
    }

    res.json({ version: rows[0].version, coins: d.coins, answered: d.answered, correct: d.correct });
  });

  /** The leaderboard the promoted columns exist for. Public, and safe to be: it shows usernames,
   *  which are the public half of an identity, and never a code or a `sub`. */
  app.get(`${base}/api/leaderboard`, async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT username, coins, answered, correct FROM progress
        WHERE username <> '' ORDER BY coins DESC LIMIT 20`,
    );
    res.json({ top: rows });
  });
}

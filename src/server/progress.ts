import type { Express, NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import pg from 'pg';

/**
 * Server-side progress: the player's document, kept for them instead of only in their browser.
 *
 * Shape: ONE JSONB DOCUMENT PER PLAYER, stored verbatim. The quiz's data was never relational (a
 * garden of cells, sessions with their own notes maps, a mid-quiz snapshot, a per-card stats map);
 * modelling it into tables would rebuild a document that already exists, then reassemble it on read.
 *
 * Promoted columns: `coins`, `answered`, `correct` are DERIVED server-side on every write, never
 * accepted from the client — otherwise a client could send 10 coins with a `coins` column of 10,000
 * and forge the leaderboard with any bearer token. Deriving makes the two disagreeing impossible.
 *
 * Guests never reach this file: no identity, no request, no row — their data stays in the browser.
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
      -- Denormalised from the token so the leaderboard can name people without a call to auth per
      -- row. The PUBLIC half of an identity, safe here; the code and sub are not, and are not here.
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
  const coins =
    typeof d.coins === 'number' && Number.isFinite(d.coins) ? Math.max(0, Math.trunc(d.coins)) : 0;

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
    const { rows } = await pool.query('SELECT data, version, updated_at FROM progress WHERE sub = $1', [
      req.sub,
    ]);
    if (!rows[0]) {
      // Not an error: a new player has nothing yet. The client then uploads its localStorage — the
      // migration path, see PUT below.
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
     * OPTIMISTIC CONCURRENCY — here because last-write-wins DESTROYS GARDENS. One identity, two
     * browsers: a stale laptop document silently overwriting an evening's phone progress, no error, no
     * rollback. So a write lands only on top of the version the client actually read; otherwise the
     * server refuses and hands back what it has (the client's merge/ask/refetch is a UI decision).
     * `version = 0` means "never read from the server", legitimate only when no row exists (the first
     * upload after sign-in); once a row exists a 0 is a stale client, rejected like any mismatch.
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

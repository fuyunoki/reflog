/**
 * セッションと Cookie の扱い。
 *
 * トークンは HttpOnly Cookie にだけ置き、JavaScript からは読めないようにする。
 * OAuth の state も Cookie で往復させ、コールバックで照合する（CSRF 対策）。
 */

export interface Env {
  readonly DB: D1Database;
  readonly GITHUB_CLIENT_ID: string;
  readonly GITHUB_CLIENT_SECRET: string;
}

export const SESSION_COOKIE = 'reflog_session';
export const STATE_COOKIE = 'reflog_oauth_state';

/** セッションの寿命。長すぎると盗まれたときの影響が大きい。 */
const SESSION_DAYS = 30;

export interface SessionUser {
  readonly playerId: string;
  readonly username: string;
  readonly avatarUrl: string | null;
}

const isoIn = (days: number): string =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

export const nowIso = (): string => new Date().toISOString();

export const readCookie = (request: Request, name: string): string | null => {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
};

export const buildCookie = (
  name: string,
  value: string,
  options: { maxAge?: number; expires?: Date } = {},
): string => {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  return parts.join('; ');
};

export const clearCookie = (name: string): string =>
  buildCookie(name, '', { maxAge: 0 });

/** セッションを発行する。トークンは推測できない値にする。 */
export const createSession = async (
  env: Env,
  playerId: string,
): Promise<{ token: string; maxAge: number }> => {
  const token = crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '');
  await env.DB.prepare(
    'INSERT INTO sessions (token, player_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(token, playerId, nowIso(), isoIn(SESSION_DAYS))
    .run();

  return { token, maxAge: SESSION_DAYS * 24 * 60 * 60 };
};

/** Cookie のセッションから利用者を引く。期限切れはその場で片付ける。 */
export const currentUser = async (
  request: Request,
  env: Env,
): Promise<SessionUser | null> => {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT s.expires_at AS expires_at, p.id AS id, p.username AS username, p.avatar_url AS avatar_url
       FROM sessions s
       JOIN players p ON p.id = s.player_id
      WHERE s.token = ?`,
  )
    .bind(token)
    .first<{
      expires_at: string;
      id: string;
      username: string;
      avatar_url: string | null;
    }>();

  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }

  return {
    playerId: row.id,
    username: row.username,
    avatarUrl: row.avatar_url,
  };
};

export const destroySession = async (request: Request, env: Env): Promise<void> => {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
};

export const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(init.headers ?? {}),
    },
  });

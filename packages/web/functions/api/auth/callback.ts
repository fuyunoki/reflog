/**
 * 認可コードをアクセストークンに交換し、セッションを張る。
 *
 * client_secret を使うのはここだけで、ブラウザには一切渡さない。
 * このゲームで唯一サーバが構造的に必要になる場所でもある。
 *
 * アクセストークン自体は保存しない。ユーザーの識別さえできればよく、
 * 持ち続けると漏れたときの被害が大きくなるため。
 */
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  buildCookie,
  clearCookie,
  createSession,
  nowIso,
  readCookie,
  type Env,
} from '../../_lib/auth';

interface GitHubUser {
  readonly id: number;
  readonly login: string;
  readonly avatar_url?: string;
}

const failure = (origin: string, reason: string): Response =>
  new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/?auth=${encodeURIComponent(reason)}`,
      'Set-Cookie': clearCookie(STATE_COOKIE),
      'Cache-Control': 'no-store',
    },
  });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const origin = url.origin;

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = readCookie(request, STATE_COOKIE);

  if (url.searchParams.get('error')) return failure(origin, 'cancelled');
  if (!code) return failure(origin, 'no_code');
  // state が合わないリクエストは、こちらが始めた認可ではない
  if (!state || !expected || state !== expected) return failure(origin, 'bad_state');

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${origin}/api/auth/callback`,
    }),
  });

  if (!tokenResponse.ok) return failure(origin, 'exchange_failed');

  const token = (await tokenResponse.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!token.access_token) return failure(origin, token.error ?? 'exchange_failed');

  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'reflog',
    },
  });
  if (!userResponse.ok) return failure(origin, 'user_fetch_failed');

  const user = (await userResponse.json()) as GitHubUser;
  const playerId = `github:${user.id}`;
  const now = nowIso();

  await env.DB.prepare(
    `INSERT INTO players (id, username, avatar_url, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       username = excluded.username,
       avatar_url = excluded.avatar_url,
       last_seen_at = excluded.last_seen_at`,
  )
    .bind(playerId, user.login, user.avatar_url ?? null, now, now)
    .run();

  const session = await createSession(env, playerId);

  const headers = new Headers({ Location: `${origin}/`, 'Cache-Control': 'no-store' });
  headers.append(
    'Set-Cookie',
    buildCookie(SESSION_COOKIE, session.token, { maxAge: session.maxAge }),
  );
  headers.append('Set-Cookie', clearCookie(STATE_COOKIE));

  return new Response(null, { status: 302, headers });
};

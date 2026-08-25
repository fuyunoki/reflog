/**
 * GitHub への認可の開始。
 *
 * 権限は read:user だけを求める。
 * このゲームが使うのは公開情報のみで、リポジトリの中身には触れないため。
 * 必要以上の権限を求めると、それだけでログインをためらわせる。
 */
import { STATE_COOKIE, buildCookie, type Env } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GITHUB_CLIENT_ID) {
    return new Response('GITHUB_CLIENT_ID が設定されていない', { status: 500 });
  }

  const url = new URL(request.url);
  // 認可後に戻ってくる先。開発でも本番でも同じ組み立てで済むよう origin から作る。
  const redirectUri = `${url.origin}/api/auth/callback`;

  // CSRF 対策。発行した state を Cookie に控え、コールバックで突き合わせる。
  const state = crypto.randomUUID();

  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('scope', 'read:user');
  authorize.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      // state は往復のあいだだけ持てばよい
      'Set-Cookie': buildCookie(STATE_COOKIE, state, { maxAge: 600 }),
      'Cache-Control': 'no-store',
    },
  });
};

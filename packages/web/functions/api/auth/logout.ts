/** セッションを破棄する。記録そのものは消さない。 */
import { SESSION_COOKIE, clearCookie, destroySession, json, type Env } from '../../_lib/auth';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  await destroySession(request, env);
  return json({ ok: true }, { headers: { 'Set-Cookie': clearCookie(SESSION_COOKIE) } });
};

/** 現在ログインしている利用者。未ログインなら null を返す（エラーにはしない）。 */
import { currentUser, json, type Env } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await currentUser(request, env);
  return json({ user });
};

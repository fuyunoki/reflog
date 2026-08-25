/**
 * 記録の保存と取り出し。
 *
 * サーバは進捗の中身を解釈しない。形を決めるのはドメイン側であり、
 * ここはそれをそのまま預かるだけにしてある。
 * こうしておくと、ゲームの仕様が変わってもマイグレーションが要らない。
 *
 * 誰の記録かは必ずセッションから決める。本文の playerId は信用しない。
 */
import { currentUser, json, nowIso, type Env } from '../_lib/auth';

/** 記録の上限。壊れたクライアントや悪意ある送信で D1 を埋めさせない。 */
const MAX_BYTES = 256 * 1024;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, { status: 401 });

  const row = await env.DB.prepare('SELECT data FROM progress WHERE player_id = ?')
    .bind(user.playerId)
    .first<{ data: string }>();

  if (!row) return json({ progress: null, playerId: user.playerId });

  try {
    return json({ progress: JSON.parse(row.data), playerId: user.playerId });
  } catch {
    // 壊れた保存で遊べなくなるより、未保存として扱うほうがよい
    return json({ progress: null, playerId: user.playerId });
  }
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.text();
  if (body.length > MAX_BYTES) {
    return json({ error: 'too_large' }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 });
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return json({ error: 'invalid_body' }, { status: 400 });
  }

  // 送られてきた playerId は無視し、セッションのものに差し替える
  const record = { ...(parsed as Record<string, unknown>), playerId: user.playerId };
  const now = nowIso();

  await env.DB.prepare(
    `INSERT INTO progress (player_id, data, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(player_id) DO UPDATE SET
       data = excluded.data,
       updated_at = excluded.updated_at`,
  )
    .bind(user.playerId, JSON.stringify(record), now)
    .run();

  return json({ ok: true, updatedAt: now });
};
